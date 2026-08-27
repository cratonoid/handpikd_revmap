# Request/response bodies for the printing purchase invoices module's
# endpoints.
#
# Mirrors schemas/purchase_invoices.py, with the numbering and the PDF as the
# two differences: the display number is PPINV-nnnn off its own series, and
# there is no branded PDF to ask for — has_uploaded_pdf is the only PDF this
# record has.
from datetime import datetime

from pydantic import BaseModel


class PrintingPurchaseInvoiceDetailItem(BaseModel):
    id: int
    printing_purchase_invoice_no: int
    printing_purchase_invoice_no_display: str
    date: datetime
    vendor_id: int
    po_id: int
    # The vendor's own invoice number, present only for orders created from
    # an uploaded vendor PDF.
    vendor_invoice_no: str | None
    has_uploaded_pdf: bool
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdatePrintingPurchaseInvoiceDetailsRequest(BaseModel):
    id: int
    # vendor_id/po_id/totals are intentionally not editable — a printing
    # purchase invoice always stays tied to whatever printing purchase order
    # it was raised against, and its amounts stay whatever that order's were
    # at create time.
    date: datetime
    is_deleted: bool = False


class UpdatePrintingPurchaseInvoiceDetailsResponse(BaseModel):
    message: str


class AttachPrintingPurchaseInvoicePdfResponse(BaseModel):
    message: str
