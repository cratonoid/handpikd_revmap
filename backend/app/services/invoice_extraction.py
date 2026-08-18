# Reads a vendor's own purchase-invoice PDF and pulls out the fields a
# purchase order needs: the vendor's GSTIN, the invoice number and date, and
# one line item per product with its quantity, rate and GST %.
#
# Two-stage by design (see extract_invoice at the bottom):
#   1. A deterministic pass over the PDF's own text layer, in this module.
#      Free, offline, and exact when it works — but every vendor lays their
#      invoice out differently, so it only succeeds on documents whose
#      columns these heuristics can decode.
#   2. Claude, in services/claude_invoice_extraction.py, on anything stage 1
#      couldn't fully read. Handles arbitrary layouts at the cost of an API
#      call.
# Whichever stage answers, the result is the same ExtractedInvoice, and it is
# always all-or-nothing: a partially-read invoice raises
# InvoiceExtractionError rather than handing back a half-filled form, since
# the admin can't tell a missed line item from an invoice that never had one.
#
# Nothing here touches the database — matching the extracted vendor/products
# against our own records, and every check that can reject an upload, lives
# in services/purchase_invoice_intake.py.
import re
from dataclasses import dataclass
from datetime import datetime

import pymupdf

# Standard 15-character GSTIN: 2-digit state code, the 10-character PAN
# (5 letters, 4 digits, 1 letter), 1 entity char, a literal Z, 1 checksum
# char.
_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b")

# An invoice number as printed after its label — vendors use everything from
# "1147" to "KAH/2026-27/00001", so this is deliberately permissive about
# what's inside and strict only about where it starts.
# The value is optional: plenty of invoices print the label in one table cell
# and the number in the cell below it, which _find_invoice_no handles by
# looking at the next line.
_INVOICE_NO_LABEL_RE = re.compile(
    r"(?:tax\s+)?(?:invoice|bill)\s*(?:no|number|#)\s*\.?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9/\-_]*)?",
    re.IGNORECASE,
)

_DATE_LABEL_RE = re.compile(r"(?:invoice\s+date|dated|date)\s*[:\-]?\s*(.{0,24})", re.IGNORECASE)
_DATE_VALUE_RE = re.compile(r"\b(\d{1,2}[-/\s][A-Za-z0-9]{1,9}[-/\s]\d{2,4})\b")

_DATE_FORMATS = ("%d-%m-%Y", "%d-%m-%y", "%d-%b-%Y", "%d-%b-%y", "%d-%B-%Y", "%d-%B-%y")

# HSN/SAC codes are 4, 6 or 8 digits. On its own that also matches plenty of
# ordinary numbers, so a row only counts as a line item when the numbers
# after this code also multiply out (see _read_line_item).
_HSN_RE = re.compile(r"\b(\d{4}|\d{6}|\d{8})\b")

_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")

# Rows that summarize the invoice rather than list a product. Matched against
# the start of the row so a product legitimately named "Total Station" isn't
# thrown away.
_SUMMARY_ROW_PREFIXES = ("total", "sub total", "subtotal", "grand total", "amount chargeable", "hsn")

_TOTAL_LABEL_RE = re.compile(r"(?:grand\s+total|total\s+amount|amount\s+chargeable)", re.IGNORECASE)

# A line item's quantity x rate has to land on its printed amount for the row
# to be read as a line item at all. Half a rupee of slack absorbs the
# per-line rounding vendors print with; anything looser starts matching
# unrelated number triples.
_AMOUNT_TOLERANCE = 0.5


class InvoiceExtractionError(RuntimeError):
    """Raised when an invoice can't be read in full.

    The message is written for the admin who uploaded the PDF and is shown to
    them as-is, so it says which field is missing rather than which regex
    failed.
    """


@dataclass(frozen=True)
class ExtractedLineItem:
    # Exactly as printed on the invoice — matched against our own product
    # names later, in services/purchase_invoice_intake.py.
    description: str
    quantity: int
    rate: float
    gst_perc: float


@dataclass(frozen=True)
class ExtractedInvoice:
    invoice_no: str
    invoice_date: datetime
    vendor_gstin: str
    # Only ever used to label the vendor in an error message — the vendor is
    # matched on GSTIN, not on this.
    vendor_name: str | None
    line_items: tuple[ExtractedLineItem, ...]
    # The invoice's own printed grand total, when one could be read. Used
    # only as a cross-check against the total derived from the line items —
    # a mismatch is reported to the admin, never a reason to reject.
    printed_total: float | None
    # "text" (this module) or "claude" (the fallback) — surfaced in the API
    # response so the review screen can say where the values came from.
    source: str


def _to_number(text: str) -> float:
    return float(text.replace(",", ""))


def page_lines(pdf_bytes: bytes) -> list[list[str]]:
    """Returns each page's text as visually-ordered lines.

    Words are regrouped by their position on the page rather than taken in
    the PDF's own content order: invoices are tables, and their content
    streams routinely emit a row's cells out of order (or bottom-up), which
    turns a naive text extraction into an unparseable jumble.
    """
    pages: list[list[str]] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
        for page in document:
            rows: dict[int, list[tuple[float, str]]] = {}
            for x0, y0, _x1, _y1, word, _block, _line, _word_no in page.get_text("words"):
                # Rounded to whole points so the cells of one visual row land
                # in the same bucket even when their baselines differ
                # slightly.
                rows.setdefault(round(y0), []).append((x0, word))
            pages.append(
                [" ".join(word for _x, word in sorted(cells)) for _y, cells in sorted(rows.items())]
            )
    return pages


def _find_vendor_gstin(lines: list[str], our_gstin: str) -> str | None:
    # Every invoice raised on us carries at least two GSTINs — the vendor's
    # and ours, the latter in the "Buyer"/"Consignee" block. The vendor's is
    # simply the one that isn't ours, which holds regardless of where either
    # sits on the page.
    ours = our_gstin.strip().upper()
    for line in lines:
        for match in _GSTIN_RE.finditer(line.upper()):
            if match.group(0) != ours:
                return match.group(0)
    return None


def _parse_date(value: str) -> datetime | None:
    cleaned = re.sub(r"[/\s]", "-", value.strip())
    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, date_format)
        except ValueError:
            continue
    return None


def _find_invoice_no(lines: list[str]) -> str | None:
    for index, line in enumerate(lines):
        match = _INVOICE_NO_LABEL_RE.search(line)
        if match is None:
            continue
        value = (match.group(1) or "").strip(" .:-")
        if value and not value.lower().startswith(("date", "dated", "no")):
            return value
        # Label-only cell: vendors whose invoice number sits in the cell
        # below the label rather than beside it are common enough to be worth
        # the one-line lookahead.
        for following in lines[index + 1 : index + 3]:
            candidate = following.strip().split(" ")[0].strip(" .:-")
            if not candidate or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9/\-_]{2,}", candidate):
                continue
            # The cell under "Invoice No." is the number; the cell under the
            # "Dated" label beside it is not, and reads as a plausible
            # invoice number if it isn't ruled out.
            if _parse_date(candidate) is None:
                return candidate
    return None


def _first_date_in(text: str) -> datetime | None:
    # Every candidate on the line is tried, not just the first: an invoice
    # number like "Sca/26-27/1147" reads as a date to any pattern loose
    # enough to cover the formats vendors actually print, and it routinely
    # sits in the cell right beside the real date.
    for match in _DATE_VALUE_RE.finditer(text):
        parsed = _parse_date(match.group(1))
        if parsed is not None:
            return parsed
    return None


def _find_invoice_date(lines: list[str]) -> datetime | None:
    # Labelled dates first ("Invoice Date", "Dated"), since an invoice also
    # carries dates that aren't its own — an e-invoice acknowledgement date,
    # a "printed on" stamp, a delivery note date. Text after the label wins
    # over the rest of its line, and the lines below it are the last resort
    # for layouts that stack the date under its label.
    for index, line in enumerate(lines):
        label = _DATE_LABEL_RE.search(line)
        if label is None:
            continue
        for text in (label.group(1), line, *lines[index + 1 : index + 3]):
            parsed = _first_date_in(text)
            if parsed is not None:
                return parsed

    for line in lines:
        parsed = _first_date_in(line)
        if parsed is not None:
            return parsed
    return None


def _find_printed_total(lines: list[str]) -> float | None:
    for line in reversed(lines):
        if _TOTAL_LABEL_RE.search(line) is None:
            continue
        numbers = [_to_number(match.group(0)) for match in _NUMBER_RE.finditer(line)]
        if numbers:
            return max(numbers)
    return None


def _hsn_gst_percentages(lines: list[str]) -> dict[str, float]:
    # Most invoices print each line's GST % in the line itself, but some only
    # state it in the HSN-wise tax summary at the foot of the page. This maps
    # HSN code -> GST % from any row carrying both, so those invoices still
    # resolve a rate per line.
    percentages: dict[str, float] = {}
    for line in lines:
        hsn = _HSN_RE.search(line)
        percent = _PERCENT_RE.search(line)
        if hsn is None or percent is None:
            continue
        percentages.setdefault(hsn.group(1), float(percent.group(1)))
    return percentages


def _find_quantity_rate(numbers: list[float]) -> tuple[int, float] | None:
    # Identifies which of a row's numbers are the quantity and the rate by
    # the one relationship every invoice line obeys — quantity x rate is the
    # line's amount — rather than by column position, which no two vendors
    # agree on. Scanning left to right and taking the first triple that
    # multiplies out picks the real quantity/rate pair ahead of coincidences
    # further along the row (tax columns, running totals).
    for i, quantity in enumerate(numbers):
        if quantity <= 0 or abs(quantity - round(quantity)) > 1e-6:
            continue
        for j in range(i + 1, len(numbers)):
            rate = numbers[j]
            if rate <= 0:
                continue
            for amount in numbers[j + 1 :]:
                if abs(quantity * rate - amount) <= _AMOUNT_TOLERANCE:
                    return int(round(quantity)), rate
    return None


def _read_line_item(line: str, hsn_percentages: dict[str, float]) -> ExtractedLineItem | None:
    stripped = line.strip().lower()
    if any(stripped.startswith(prefix) for prefix in _SUMMARY_ROW_PREFIXES):
        return None

    hsn = _HSN_RE.search(line)
    if hsn is None:
        return None

    after_hsn = line[hsn.end() :]
    numbers = [_to_number(match.group(0)) for match in _NUMBER_RE.finditer(after_hsn)]
    quantity_rate = _find_quantity_rate(numbers)
    if quantity_rate is None:
        return None
    quantity, rate = quantity_rate

    # A row can print CGST %, SGST % and IGST % as separate columns (of which
    # two are always 0), so the line's rate is their sum — the same
    # blended-rate convention _compute_totals in routes/orders.py uses.
    percentages = [float(match.group(1)) for match in _PERCENT_RE.finditer(after_hsn)]
    gst_perc = sum(percentages) if percentages else hsn_percentages.get(hsn.group(1))
    if gst_perc is None:
        return None

    # Drop the leading serial number ("1  Ab80 Gym Shaker Bottle") — it's the
    # row's position in the table, not part of the product's name.
    description = re.sub(r"^\d+[.)]?\s+", "", line[: hsn.start()].strip()).strip()
    if not description:
        return None

    return ExtractedLineItem(description=description, quantity=quantity, rate=rate, gst_perc=gst_perc)


def _read_line_items(pages: list[list[str]], invoice_no: str | None) -> list[ExtractedLineItem]:
    # Many vendors ship the same invoice several times in one PDF — an
    # "Original for Recipient" page followed by a "Duplicate for
    # Transporter". Those copies repeat the invoice number, which is what
    # separates them from a genuine second page of line items; reading them
    # too would double every quantity.
    if invoice_no is not None:
        pages_with_invoice_no = [page for page in pages if any(invoice_no in line for line in page)]
        if len(pages_with_invoice_no) > 1:
            pages = pages_with_invoice_no[:1]

    line_items: list[ExtractedLineItem] = []
    for page in pages:
        hsn_percentages = _hsn_gst_percentages(page)
        for line in page:
            item = _read_line_item(line, hsn_percentages)
            if item is not None:
                line_items.append(item)
    return line_items


def extract_invoice_from_text(pdf_bytes: bytes, our_gstin: str) -> ExtractedInvoice | None:
    """Deterministic pass. Returns None when the PDF isn't fully readable."""
    pages = page_lines(pdf_bytes)
    lines = [line for page in pages for line in page]
    if not lines:
        return None

    vendor_gstin = _find_vendor_gstin(lines, our_gstin)
    invoice_no = _find_invoice_no(lines)
    invoice_date = _find_invoice_date(lines)
    line_items = _read_line_items(pages, invoice_no)

    if vendor_gstin is None or invoice_no is None or invoice_date is None or not line_items:
        return None

    return ExtractedInvoice(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        vendor_gstin=vendor_gstin,
        vendor_name=None,
        line_items=tuple(line_items),
        printed_total=_find_printed_total(lines),
        source="text",
    )


async def extract_invoice(pdf_bytes: bytes, our_gstin: str) -> ExtractedInvoice:
    """Reads an invoice PDF, falling back to Claude when the text pass can't.

    Raises InvoiceExtractionError if neither stage can produce a complete
    invoice.
    """
    # Imported here rather than at module scope so the deterministic pass —
    # and the tests that exercise it — never depend on the Anthropic SDK
    # being installed.
    from app.services.claude_invoice_extraction import extract_invoice_with_claude

    extracted = extract_invoice_from_text(pdf_bytes, our_gstin)
    if extracted is not None:
        return extracted

    return await extract_invoice_with_claude(pdf_bytes, our_gstin)
