# Renders a PurchaseInvoiceDetails row into our own branded PDF. Purchase
# invoices are structurally the same document as a sales invoice — a
# letterhead, one "other party" detail box, a GST line-item table, totals —
# just with the vendor standing in the party-detail box instead of the
# customer, so this is a thin relabeling wrapper around
# invoice_pdf.generate_invoice_pdf rather than a parallel ~400-line
# ReportLab layout. Our own GSTIN (from personal_details) is always what's
# shown in the top-left GSTIN box regardless of direction, so no other
# differences are needed. The tax split itself is passed in rather than
# re-derived: it was decided when the purchase ORDER was placed (see
# services/purchase_invoices.py), and the PDF has to state the heads the
# order was actually placed under.
from __future__ import annotations

from datetime import datetime

from app.services.gst import TaxKind
from app.services.invoice_pdf import InvoiceLineItem, generate_invoice_pdf

PurchaseInvoiceLineItem = InvoiceLineItem


async def generate_purchase_invoice_pdf(
    *,
    purchase_invoice_no: str,
    invoice_date: datetime,
    line_items: list[PurchaseInvoiceLineItem],
    total_amount_before_tax: float,
    total_tax_amount: float,
    total_amount_after_tax: float,
    vendor_name: str,
    vendor_address: str,
    vendor_phone: str,
    vendor_gstin: str,
    personal: dict[str, str],
    tax_kind: TaxKind | None = None,
    place_of_supply_code: str = "",
) -> bytes:
    return await generate_invoice_pdf(
        invoice_no=purchase_invoice_no,
        invoice_date=invoice_date,
        due_date=invoice_date,
        transport="",
        line_items=line_items,
        total_amount_before_tax=total_amount_before_tax,
        total_tax_amount=total_tax_amount,
        total_amount_after_tax=total_amount_after_tax,
        customer_name=vendor_name,
        customer_address=vendor_address,
        customer_phone=vendor_phone,
        customer_gstin=vendor_gstin,
        personal=personal,
        title_text="PURCHASE INVOICE",
        party_label="Vendor",
        tax_kind=tax_kind,
        place_of_supply_code=place_of_supply_code,
    )
