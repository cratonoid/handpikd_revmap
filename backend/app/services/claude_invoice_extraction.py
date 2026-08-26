# Claude-backed fallback for reading a vendor's purchase-invoice PDF, used
# only when the deterministic pass in services/invoice_extraction.py can't
# decode the document's layout (see extract_invoice there for the two-stage
# flow, and why the deterministic pass is tried first).
#
# The PDF is sent as a document block rather than as extracted text: the
# layouts that defeat the text pass are exactly the ones where reading order
# has fallen apart, and Claude sees the rendered page. Structured outputs
# (output_format=_ExtractedInvoiceModel) constrain the response to the schema
# below, so the result is parsed, not scraped.
#
# Configuration lives in core/config.py: anthropic_api_key (unset disables
# this fallback entirely — a PDF the text pass can't read is then rejected
# with a message telling the admin to fill the form in by hand) and
# invoice_extraction_model.
import base64
from datetime import datetime

import anthropic
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.invoice_extraction import ExtractedInvoice, ExtractedLineItem, InvoiceExtractionError

_SYSTEM_PROMPT = """You read Indian GST tax invoices that a vendor has issued to our company, and return their contents as structured data.

Rules:
- vendor_gstin is the GSTIN of the SELLER (the party issuing the invoice), never the buyer's/consignee's. Our own GSTIN is given in the user message — never return that one.
- invoice_no is the seller's own invoice number exactly as printed, including any prefix and slashes.
- invoice_date is the invoice's own date (not the e-invoice acknowledgement date, not a "printed on" date), as YYYY-MM-DD.
- One line item per product row in the invoice's item table. Ignore tax summary rows, totals, round-off and freight/labour rows.
- description is the product's description exactly as printed, without the serial number.
- hsn_code is that row's HSN/SAC code, empty if the row doesn't carry one.
- quantity is the number of units billed, as a whole number.
- rate is the per-unit rate BEFORE tax. If the invoice prints both a tax-inclusive and a taxable rate, return the taxable one, and make sure quantity * rate equals the row's taxable amount.
- gst_perc is that row's total GST percentage: IGST alone, or CGST + SGST added together. If the row itself doesn't state it, take it from the invoice's HSN-wise tax summary.
- printed_total is the invoice's grand total payable, including tax.
- If the document is not a tax invoice, or any of these values genuinely cannot be read, leave the field empty rather than guessing.
"""


class _ExtractedLineItemModel(BaseModel):
    description: str = Field(description="Product description exactly as printed on the invoice")
    hsn_code: str = Field(default="", description="That row's HSN/SAC code, empty if not printed")
    quantity: int = Field(description="Units billed, as a whole number")
    rate: float = Field(description="Per-unit rate before tax")
    gst_perc: float = Field(description="Total GST % for this row (IGST, or CGST + SGST)")


class _ExtractedInvoiceModel(BaseModel):
    vendor_gstin: str = Field(description="The seller's GSTIN, never the buyer's")
    vendor_name: str = Field(description="The seller's registered name as printed")
    invoice_no: str = Field(description="The seller's own invoice number, exactly as printed")
    invoice_date: str = Field(description="The invoice's own date, as YYYY-MM-DD")
    line_items: list[_ExtractedLineItemModel]
    printed_total: float = Field(description="Grand total payable including tax, 0 if not printed")


def _client() -> anthropic.AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise InvoiceExtractionError(
            "this invoice's layout couldn't be read automatically, and PDF reading by Claude is not "
            "configured on this server — enter the purchase order manually instead"
        )
    # 3 minutes: reading a multi-page invoice is a single request, and the
    # admin is waiting on it in a modal, so this fails fast rather than
    # sitting on the default 10-minute client timeout.
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=180.0)


async def extract_invoice_with_claude(pdf_bytes: bytes, our_gstin: str) -> ExtractedInvoice:
    client = _client()

    try:
        response = await client.messages.parse(
            model=settings.invoice_extraction_model,
            max_tokens=16000,
            system=_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": base64.standard_b64encode(pdf_bytes).decode("ascii"),
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Our own GSTIN (the buyer's) is {our_gstin or 'not on file'}. "
                                "Extract this invoice."
                            ),
                        },
                    ],
                }
            ],
            output_format=_ExtractedInvoiceModel,
        )
    except anthropic.APIStatusError as error:
        raise InvoiceExtractionError(
            f"couldn't read this invoice automatically (Claude returned {error.status_code}) — "
            "enter the purchase order manually instead"
        ) from error
    except anthropic.APIConnectionError as error:
        raise InvoiceExtractionError(
            "couldn't reach Claude to read this invoice — try again, or enter the purchase order manually"
        ) from error

    parsed = response.parsed_output
    if parsed is None:
        raise InvoiceExtractionError(
            "couldn't read this invoice's contents — enter the purchase order manually instead"
        )

    return _to_extracted_invoice(parsed)


def _to_extracted_invoice(parsed: _ExtractedInvoiceModel) -> ExtractedInvoice:
    # Same all-or-nothing rule as the deterministic pass: the prompt asks for
    # empty fields rather than guesses, so anything missing here means the
    # invoice genuinely couldn't be read and the admin is told which part.
    missing = [
        name
        for name, value in (
            ("the vendor's GSTIN", parsed.vendor_gstin.strip()),
            ("the invoice number", parsed.invoice_no.strip()),
            ("the invoice date", parsed.invoice_date.strip()),
        )
        if not value
    ]
    if not parsed.line_items:
        missing.append("any product line items")
    if missing:
        raise InvoiceExtractionError(f"couldn't read {', '.join(missing)} from this invoice")

    try:
        invoice_date = datetime.strptime(parsed.invoice_date.strip(), "%Y-%m-%d")
    except ValueError:
        raise InvoiceExtractionError(f"couldn't read the invoice date ('{parsed.invoice_date}') from this invoice")

    for item in parsed.line_items:
        if not item.description.strip() or item.quantity <= 0 or item.rate <= 0:
            raise InvoiceExtractionError(
                f"couldn't read a complete line item from this invoice (got '{item.description}', "
                f"quantity {item.quantity}, rate {item.rate})"
            )

    return ExtractedInvoice(
        invoice_no=parsed.invoice_no.strip(),
        invoice_date=invoice_date,
        vendor_gstin=parsed.vendor_gstin.strip().upper(),
        vendor_name=parsed.vendor_name.strip() or None,
        line_items=tuple(
            ExtractedLineItem(
                description=item.description.strip(),
                hsn_code=item.hsn_code.strip(),
                quantity=item.quantity,
                rate=item.rate,
                gst_perc=item.gst_perc,
            )
            for item in parsed.line_items
        ),
        printed_total=parsed.printed_total or None,
        source="claude",
    )
