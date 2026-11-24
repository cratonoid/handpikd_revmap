# Request/response bodies for the invoices module's endpoints.
from datetime import date, datetime

from pydantic import BaseModel, model_validator

from app.models.invoice_details import InvoiceBilling, InvoiceState, InvoiceStatus, InvoiceType, OnlineOrOffline


def check_partial(billing: InvoiceBilling, partial_percent: float | None, partial_amount: float | None) -> None:
    # A partial invoice takes exactly one of partial_percent (of the orders'
    # value) or partial_amount (rupees, tax included); a full one takes
    # neither. See InvoiceBilling.
    if billing == InvoiceBilling.full:
        if partial_percent is not None or partial_amount is not None:
            raise ValueError("a full invoice takes no partial percentage or amount")
        return
    if (partial_percent is None) == (partial_amount is None):
        raise ValueError("a partial invoice needs either a percentage or an amount")
    if partial_percent is not None and not 0 < partial_percent <= 100:
        raise ValueError("the percentage must be more than 0 and at most 100")
    if partial_amount is not None and partial_amount <= 0:
        raise ValueError("the amount must be more than 0")


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
    notes: str = ""
    # Full by default. A partial invoice takes exactly one of partial_percent
    # (of the orders' value) or partial_amount (rupees, tax included) — see
    # InvoiceBilling. Editable while the invoice is a draft, fixed once it is
    # issued.
    billing: InvoiceBilling = InvoiceBilling.full
    partial_percent: float | None = None
    partial_amount: float | None = None

    @model_validator(mode="after")
    def _check_sales_ids(self) -> "CreateNewInvoiceRequest":
        if not self.sales_ids:
            raise ValueError("at least one sales order is required")
        if len(set(self.sales_ids)) != len(self.sales_ids):
            raise ValueError("sales_ids must not contain duplicates")
        return self

    @model_validator(mode="after")
    def _check_partial(self) -> "CreateNewInvoiceRequest":
        check_partial(self.billing, self.partial_percent, self.partial_amount)
        return self


class CreateNewInvoiceResponse(BaseModel):
    message: str
    # The new draft, so the form can go straight on to issuing or printing it.
    id: int
    invoice_no_display: str


class InvoiceDetailItem(BaseModel):
    id: int
    # None on a draft — see InvoiceState.
    invoice_no: int | None
    invoice_no_display: str
    date: datetime
    sales_ids: list[int]
    quotation_id: int | None
    cust_id: int | None
    type: InvoiceType
    billing: InvoiceBilling = InvoiceBilling.full
    partial_percent: float | None = None
    partial_amount: float | None = None
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str
    status: InvoiceStatus
    # When the payment came in — see InvoiceDetails.paid_on.
    paid_on: date | None = None
    # Parallel arrays, one entry per line item — populated for proforma
    # invoices (own line items, see ProformaInvoiceSummary), empty for
    # standard invoices (whose line items live on the linked SalesOrders'
    # SalesSummary instead and aren't surfaced here).
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str
    notes: str
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool
    state: InvoiceState = InvoiceState.issued
    issued_at: datetime | None = None
    issued_by: str = ""


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
    notes: str = ""
    # Like QuotationDetails.status, only ever settable in edit mode — a new
    # invoice is always created as InvoiceStatus.unpaid (see
    # create_new_invoice, which leaves the model default in place).
    status: InvoiceStatus
    # The payment date, read only when status is paid. Blank keeps the date
    # already on file, or takes today if there is none (see
    # _apply_payment_state in routes/invoices.py).
    paid_on: date | None = None
    is_deleted: bool = False
    # Drafts only: the new billing. Left out (None) keeps what the invoice
    # has. An issued invoice ignores every field above except status,
    # paid_on and is_deleted, and refuses a billing change outright.
    billing: InvoiceBilling | None = None
    partial_percent: float | None = None
    partial_amount: float | None = None

    @model_validator(mode="after")
    def _check_partial(self) -> "UpdateInvoiceDetailsRequest":
        if self.billing is None:
            if self.partial_percent is not None or self.partial_amount is not None:
                raise ValueError("a partial percentage or amount needs billing set to partial")
            return self
        check_partial(self.billing, self.partial_percent, self.partial_amount)
        return self


class UpdateInvoiceDetailsResponse(BaseModel):
    message: str


class IssueInvoiceRequest(BaseModel):
    id: int


class IssueInvoiceResponse(BaseModel):
    message: str
    # The number it was just given (H/26-27/41).
    invoice_no_display: str


class DeleteDraftInvoiceRequest(BaseModel):
    id: int


class DeleteDraftInvoiceResponse(BaseModel):
    message: str


# The sales invoices table's inline status dropdown. Deliberately NOT
# UpdateInvoiceDetailsRequest with one field swapped: that endpoint
# re-snapshots the totals off the linked sales orders and re-decides the tax
# context, neither of which marking an invoice paid should touch.
class UpdateInvoiceStatusRequest(BaseModel):
    id: int
    status: InvoiceStatus
    # As on UpdateInvoiceDetailsRequest: blank keeps the date on file or
    # takes today. The table's "Paid on" cell sends status paid plus the
    # date the admin picked.
    paid_on: date | None = None


class UpdateInvoiceStatusResponse(BaseModel):
    message: str
    # The payment date the invoice ended up with, so the table can show the
    # one the server picked without reloading.
    paid_on: date | None = None


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
    notes: str = ""

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
    notes: str = ""

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
