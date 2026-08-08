# Request/response bodies for the invoices module's endpoints.
from datetime import datetime

from pydantic import BaseModel

from app.models.invoice_details import InvoiceType, OnlineOrOffline


class CreateNewInvoiceRequest(BaseModel):
    sales_id: int
    date: datetime
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""


class CreateNewInvoiceResponse(BaseModel):
    message: str


class InvoiceDetailItem(BaseModel):
    id: int
    invoice_no: int
    date: datetime
    sales_id: int
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdateInvoiceDetailsRequest(BaseModel):
    id: int
    # sales_id is intentionally not editable — an invoice always stays tied
    # to the sales order it was raised against.
    date: datetime
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""
    is_deleted: bool = False


class UpdateInvoiceDetailsResponse(BaseModel):
    message: str
