# Request/response bodies for the purchase invoices module's endpoints.
from datetime import datetime

from pydantic import BaseModel


class CreateNewPurchaseInvoiceRequest(BaseModel):
    date: datetime
    po_id: int


class CreateNewPurchaseInvoiceResponse(BaseModel):
    message: str
    id: int


class PurchaseInvoiceDetailItem(BaseModel):
    id: int
    purchase_invoice_no: int
    purchase_invoice_no_display: str
    date: datetime
    vendor_id: int
    po_id: int
    has_uploaded_pdf: bool
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdatePurchaseInvoiceDetailsRequest(BaseModel):
    id: int
    # vendor_id/po_id/totals are intentionally not editable — a purchase
    # invoice always stays tied to whatever purchase order it was raised
    # against, and its amounts stay whatever that order's were at create time.
    date: datetime
    is_deleted: bool = False


class UpdatePurchaseInvoiceDetailsResponse(BaseModel):
    message: str


class AttachPurchaseInvoicePdfResponse(BaseModel):
    message: str
