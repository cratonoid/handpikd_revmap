# Request/response bodies for the invoices module's endpoints.
from datetime import datetime

from pydantic import BaseModel

from app.models.invoice_details import InvoiceStatus, InvoiceType, OnlineOrOffline


class CreateNewInvoiceRequest(BaseModel):
    # Manual creation is standard-only — proforma invoices are generated
    # automatically when a quotation is marked accepted (see
    # routes/quotations.py), so sales_id is the only linkage accepted here;
    # type is implied and validated server-side as InvoiceType.standard.
    sales_id: int
    date: datetime
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""


class CreateNewInvoiceResponse(BaseModel):
    message: str


class InvoiceDetailItem(BaseModel):
    id: int
    invoice_no: int
    invoice_no_display: str
    date: datetime
    sales_id: int | None
    quotation_id: int | None
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str
    status: InvoiceStatus
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdateInvoiceDetailsRequest(BaseModel):
    id: int
    # sales_id/quotation_id/type are intentionally not editable — an
    # invoice always stays tied to whatever it was raised against, and its
    # type determines which of those two FKs is populated.
    date: datetime
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""
    # Like QuotationDetails.status, only ever settable in edit mode — a new
    # invoice is always created as InvoiceStatus.new (see create_new_invoice).
    status: InvoiceStatus
    is_deleted: bool = False


class UpdateInvoiceDetailsResponse(BaseModel):
    message: str
