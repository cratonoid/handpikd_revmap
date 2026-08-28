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
# looking down the label's own column.
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

# The grand total of a Tally-style invoice, which labels it with a bare
# "Total" that _TOTAL_LABEL_RE can't take (far too many rows open with that
# word) but prints against a currency symbol that nothing else on the page
# does. Both parts are needed: the HSN-wise tax summary at the foot ends in
# its own "Total 2,495.00 440.65 440.65" row, which is a subtotal of the
# taxable value and would otherwise be read as the invoice's total — and
# being further down the page, it would win.
#
# "ī" is in there because that is what the rupee sign extracts as from some
# of these PDFs: Tally embeds a subset font whose ₹ glyph sits at a codepoint
# the encoding maps to U+012B, so the same vendor's invoices come out as
# "Total 5 nos ₹ 2,936.00" or "Total ī 40,515.00" depending on which build
# wrote them. Matching the mis-decode is what makes the second kind readable
# at all; it costs nothing, since no invoice prints a real ī here.
_CURRENCY_TOTAL_ROW_RE = re.compile(r"^total\b.*(?:₹|ī|\bRs\.?\b|\bINR\b)", re.IGNORECASE)

# How far apart two words may sit vertically and still count as one row, as
# a fraction of the page's typical line height. Invoices set the cells of a
# single row in different fonts and sizes — Tally prints a row's description,
# serial number and HSN code at three baselines up to two points apart — so
# grouping on the exact top coordinate shatters one row into fragments that
# no longer read as a line item. Kept well under 1 because genuinely adjacent
# rows sit close to a full line height apart.
_ROW_TOLERANCE_RATIO = 0.4

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
    # The line's HSN/SAC code. Not used for matching (a code covers a whole
    # class of goods, not one product), but carried through so that a line
    # whose product isn't on file yet can pre-fill the new product's own HSN
    # code rather than making the admin read it back off the PDF.
    hsn_code: str
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


@dataclass(frozen=True)
class Row:
    """One visual row of a page, with each cell's left edge kept.

    The positions matter beyond ordering the text: a label and the value
    printed underneath it are only related by sitting in the same column, so
    _find_invoice_no needs to ask which cell that is rather than guess from
    where the word falls in the joined line.
    """

    cells: tuple[tuple[float, str], ...]

    @property
    def text(self) -> str:
        return " ".join(word for _left, word in self.cells)

    def column_at(self, offset: int) -> float | None:
        """Left edge of the cell holding the given offset into `text`."""
        position = 0
        for left, word in self.cells:
            if position <= offset < position + len(word):
                return left
            position += len(word) + 1
        return None

    def word_in_column(self, left: float) -> str | None:
        """The word in whichever of this row's cells sits nearest `left`."""
        if not self.cells:
            return None
        return min(self.cells, key=lambda cell: abs(cell[0] - left))[1]


def _group_into_rows(words: list[tuple[float, float, float, str]]) -> list[Row]:
    """Regroups one page's (top, bottom, left, text) words into visual rows."""
    if not words:
        return []

    # Sized off the page's own text rather than fixed in points, so the same
    # rule holds for an invoice set in 7pt and one set in 12pt.
    heights = sorted(bottom - top for top, bottom, _left, _text in words)
    tolerance = _ROW_TOLERANCE_RATIO * heights[len(heights) // 2]

    # Ordered and compared on each word's vertical centre rather than its top
    # edge: a row's cells are routinely set in different sizes, and a taller
    # cell's top edge sits further from its neighbours' than its centre does.
    ordered = sorted(words, key=lambda word: ((word[0] + word[1]) / 2, word[2]))

    rows: list[tuple[float, list[tuple[float, str]]]] = []
    for top, bottom, left, text in ordered:
        centre = (top + bottom) / 2
        # Measured against the row's first centre, not its last, so that a
        # run of slightly-offset words can't drag one row down the page.
        if rows and centre - rows[-1][0] <= tolerance:
            rows[-1][1].append((left, text))
        else:
            rows.append((centre, [(left, text)]))

    return [Row(cells=tuple(sorted(cells))) for _centre, cells in rows]


def page_rows(pdf_bytes: bytes) -> list[list[Row]]:
    """Returns each page's text as visually-ordered rows.

    Words are regrouped by their position on the page rather than taken in
    the PDF's own content order: invoices are tables, and their content
    streams routinely emit a row's cells out of order (or bottom-up), which
    turns a naive text extraction into an unparseable jumble.
    """
    pages: list[list[Row]] = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as document:
        for page in document:
            pages.append(
                _group_into_rows(
                    [
                        (y0, y1, x0, word)
                        for x0, y0, _x1, y1, word, _block, _line, _word_no in page.get_text("words")
                    ]
                )
            )
    return pages


def page_lines(pdf_bytes: bytes) -> list[list[str]]:
    """Returns each page's text as visually-ordered lines."""
    return [[row.text for row in page] for page in page_rows(pdf_bytes)]


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


def _find_invoice_no(rows: list[Row]) -> str | None:
    for index, row in enumerate(rows):
        match = _INVOICE_NO_LABEL_RE.search(row.text)
        if match is None:
            continue
        value = (match.group(1) or "").strip(" .:-")
        if value and not value.lower().startswith(("date", "dated", "no")):
            return value

        # Label-only cell: vendors whose invoice number sits in the cell
        # below the label rather than beside it are common enough to be worth
        # the lookahead. The number is found by following the label's own
        # column down, not by taking the row below's first word — that row
        # spans the full page width and usually opens with whatever the
        # letterhead prints on the left ("BRANCH OFFICE"), which has nothing
        # to do with the invoice number.
        column = row.column_at(match.start())
        if column is None:
            continue
        for following in rows[index + 1 : index + 3]:
            candidate = (following.word_in_column(column) or "").strip(" .:-")
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9/\-_]{2,}", candidate):
                continue
            # A digit rules out the ordinary prose a wide row can put in this
            # column ("Delivery"); every invoice number carries one. The date
            # check rules out the cell under the "Dated" label beside it,
            # which reads as a plausible invoice number otherwise.
            if any(character.isdigit() for character in candidate) and _parse_date(candidate) is None:
                return candidate
    return None


def _first_date_in(text: str) -> datetime | None:
    # Every candidate on the line is tried, not just the first: an invoice
    # number like "Sca/26-27/1147" reads as a date to any pattern loose
    # enough to cover the formats vendors actually print, and it routinely
    # sits in the cell right beside the real date.
    #
    # Searching resumes one character past where a rejected candidate STARTED
    # rather than past where it ended, because those two cells are printed
    # adjacently and the pattern runs straight from one into the other:
    # "PC/2026-27/72 24-Aug-26" matches "27/72 24", which is not a date and
    # which has eaten the "24" the real date begins with. Skipping past it
    # would lose that date entirely, which is exactly what used to send this
    # invoice to the Claude fallback.
    position = 0
    while (match := _DATE_VALUE_RE.search(text, position)) is not None:
        parsed = _parse_date(match.group(1))
        if parsed is not None:
            return parsed
        position = match.start() + 1
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
    # An explicit label wins wherever there is one, which is the whole of
    # this on invoices that print "Grand Total" or "Total Amount".
    for line in reversed(lines):
        if _TOTAL_LABEL_RE.search(line) is None:
            continue
        numbers = [_to_number(match.group(0)) for match in _NUMBER_RE.finditer(line)]
        if numbers:
            return max(numbers)

    # Only then the bare-"Total"-with-a-currency-symbol row. Second because
    # it's the looser of the two rules, and because an invoice that labels
    # its total properly shouldn't have that reading overridden by a row
    # further down the page. Reached by every Tally invoice, which prints
    # "Amount Chargeable (in words)" as a label with no number beside it and
    # so gets nothing out of the pass above.
    for line in reversed(lines):
        if _CURRENCY_TOTAL_ROW_RE.match(line.strip()) is None:
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

    # Every 4/6/8-digit number on the row is tried as its HSN code, not just
    # the first, because a product's own name can carry one: Mutha bills
    # "Trophy 7013 70139900 1 pcs 1,000.00", where the model number in the
    # description reads as an HSN code and swallows the real one into the
    # numbers after it. Reading stops at the first candidate that yields a
    # complete line item, so a row the first candidate already decoded is
    # unaffected — the wrong candidate is rejected by the checks below
    # (its "rate" and "quantity" no longer multiply out to the row's amount,
    # or its code resolves no GST %), and the real code is picked up on the
    # next pass.
    for hsn in _HSN_RE.finditer(line):
        item = _read_line_item_at(line, hsn, hsn_percentages)
        if item is not None:
            return item
    return None


def _read_line_item_at(
    line: str, hsn: re.Match[str], hsn_percentages: dict[str, float]
) -> ExtractedLineItem | None:
    """Reads one row on the assumption that `hsn` is its HSN/SAC cell."""
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

    return ExtractedLineItem(
        description=description,
        hsn_code=hsn.group(1),
        quantity=quantity,
        rate=rate,
        gst_perc=gst_perc,
    )


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
    rows = page_rows(pdf_bytes)
    pages = [[row.text for row in page] for page in rows]
    lines = [line for page in pages for line in page]
    if not lines:
        return None

    vendor_gstin = _find_vendor_gstin(lines, our_gstin)
    invoice_no = _find_invoice_no([row for page in rows for row in page])
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
