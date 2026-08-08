# Request/response bodies for the quotations module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.models.quotation_details import QuotationStatus


class CreateNewQuotationRequest(BaseModel):
    cust_id: int
    date: datetime
    valid_till: datetime
    # Parallel arrays, one entry per line item — same convention as
    # CreateNewSalesOrderRequest's product_ids/quantities/rates/tax_percs.
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str = ""

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewQuotationRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class CreateNewQuotationResponse(BaseModel):
    message: str
    id: int
    quotation_no: int


class QuotationDetailItem(BaseModel):
    id: int
    quotation_no: int
    date: datetime
    valid_till: datetime
    cust_id: int
    status: QuotationStatus
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    is_deleted: bool


class UpdateQuotationDetailsRequest(BaseModel):
    id: int
    # status and is_deleted are only ever submitted on update — a new
    # quotation is always created as "draft" and not deleted, same
    # convention as UpdateSalesOrderDetailsRequest's order_status_id.
    status: QuotationStatus
    is_deleted: bool = False
    cust_id: int
    date: datetime
    valid_till: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str = ""

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdateQuotationDetailsRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class UpdateQuotationDetailsResponse(BaseModel):
    message: str
