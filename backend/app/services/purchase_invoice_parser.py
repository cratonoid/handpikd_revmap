# Best-effort local text extraction for uploaded vendor purchase-invoice
# PDFs — no LLM involved (none is wired into this backend). Pulls raw text
# via pymupdf (already a dependency, used elsewhere for catalogue PDF
# pages) and applies regex heuristics for the handful of fields worth
# prefilling. Every field is Optional and remains fully admin-editable in
# the UI afterward: this is a convenience prefill, not an authoritative
# read, and low/failed extraction should never block manual entry.
from __future__ import annotations

import re
from datetime import datetime

import pymupdf
from pydantic import BaseModel

_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b")
_TOTAL_RE = re.compile(
    r"(?:grand\s*total|total\s*amount|total)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+\.\d{2}|[\d,]+)",
    re.IGNORECASE,
)
_DATE_PATTERNS = [
    re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b"),
    re.compile(r"\b(\d{4}-\d{2}-\d{2})\b"),
]
_DATE_FORMATS = ["%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y", "%Y-%m-%d"]


class ParsedPurchaseInvoiceLineItem(BaseModel):
    description: str
    quantity: float | None = None
    rate: float | None = None


class ParsedPurchaseInvoice(BaseModel):
    vendor_name: str | None = None
    vendor_gstin: str | None = None
    suggested_vendor_id: int | None = None
    date: datetime | None = None
    total_amount_after_tax: float | None = None
    line_items: list[ParsedPurchaseInvoiceLineItem] = []


def _extract_text(pdf_bytes: bytes) -> str:
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def _parse_amount(raw: str) -> float | None:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def _guess_date(text: str) -> datetime | None:
    for pattern in _DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(match.group(1), fmt)
            except ValueError:
                continue
    return None


def _guess_total(text: str) -> float | None:
    amounts = [_parse_amount(m.group(1)) for m in _TOTAL_RE.finditer(text)]
    amounts = [a for a in amounts if a is not None]
    return max(amounts) if amounts else None


def _guess_vendor_name(text: str) -> str | None:
    # Best-effort only: the first non-empty line of a vendor's own PDF is
    # very often their letterhead/company name. No attempt at a smarter
    # heuristic — the admin reviews and corrects this in the UI regardless.
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def parse_purchase_invoice_pdf(pdf_bytes: bytes) -> ParsedPurchaseInvoice:
    text = _extract_text(pdf_bytes)

    gstin_match = _GSTIN_RE.search(text)
    vendor_gstin = gstin_match.group(0) if gstin_match else None

    return ParsedPurchaseInvoice(
        vendor_name=_guess_vendor_name(text),
        vendor_gstin=vendor_gstin,
        date=_guess_date(text),
        total_amount_after_tax=_guess_total(text),
        line_items=[],
    )
