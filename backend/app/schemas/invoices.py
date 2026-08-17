# Request/response bodies for the invoices module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.models.invoice_details import InvoiceStatus, InvoiceType, OnlineOrOffline


class CreateNewInvoiceRequest(BaseModel):
    # Manual creation here is standard-only — sales_ids is the only linkage
    # accepted; type is implied and validated server-side as
    # InvoiceType.standard. Proforma invoices are created via
    # CreateNewProformaInvoiceRequest/create_new_proforma_invoice instead.
    # All referenced sales orders must belong to the same customer — enforced
    # in create_new_invoice, since the PDF shows a single customer.
    sales_ids: list[int]
    date: datetime
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""

    @model_validator(mode="after")
    def _check_sales_ids(self) -> "CreateNewInvoiceRequest":
        if not self.sales_ids:
            raise ValueError("at least one sales order is required")
        if len(set(self.sales_ids)) != len(self.sales_ids):
            raise ValueError("sales_ids must not contain duplicates")
        return self


class CreateNewInvoiceResponse(BaseModel):
    message: str


class InvoiceDetailItem(BaseModel):
    id: int
    invoice_no: int
    invoice_no_display: str
    date: datetime
    sales_ids: list[int]
    quotation_id: int | None
    cust_id: int | None
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str
    status: InvoiceStatus
    # Parallel arrays, one entry per line item — populated for proforma
    # invoices (own line items, see ProformaInvoiceSummary), empty for
    # standard invoices (whose line items live on the linked SalesOrders'
    # SalesSummary instead and aren't surfaced here).
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool


class UpdateInvoiceDetailsRequest(BaseModel):
    id: int
    # sales_ids/type are intentionally not editable — a standard invoice
    # always stays tied to the sales orders it was raised against. This
    # endpoint is standard-only; proforma invoices are edited via
    # UpdateProformaInvoiceDetailsRequest/update_proforma_invoice_details.
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


class CreateNewProformaInvoiceRequest(BaseModel):
    cust_id: int
    date: datetime
    due_date: datetime
    # Parallel arrays, one entry per line item — same convention as
    # CreateNewQuotationRequest's product_ids/quantities/rates/tax_percs.
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str = ""

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewProformaInvoiceRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class CreateNewProformaInvoiceResponse(BaseModel):
    message: str
    id: int
    invoice_no_display: str


class UpdateProformaInvoiceDetailsRequest(BaseModel):
    id: int
    is_deleted: bool = False
    cust_id: int
    date: datetime
    due_date: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str = ""

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdateProformaInvoiceDetailsRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class UpdateProformaInvoiceDetailsResponse(BaseModel):
    message: str
