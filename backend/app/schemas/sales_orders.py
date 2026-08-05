# Request/response bodies for the sales orders module's endpoints.
from pydantic import BaseModel, model_validator


class CreateNewSalesOrderRequest(BaseModel):
    cust_id: int
    # Parallel arrays, one entry per line item (mirrors
    # CreateNewPurchaseOrderRequest's product_ids/quantities/rates, plus
    # tax_percs since sales order tax is captured per line item rather than
    # as a flat order-level SGST/CGST/IGST amount).
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str
    # Optional: purchase order(s) this sales order is fulfilled from.
    related_purchase_order_ids: list[int] = []

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewSalesOrderRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class CreateNewSalesOrderResponse(BaseModel):
    message: str


class SalesOrderDetailItem(BaseModel):
    id: int
    order_no: int
    order_status_id: int
    cust_id: int
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    related_purchase_order_ids: list[int]
    is_deleted: bool


class UpdateSalesOrderDetailsRequest(BaseModel):
    id: int
    # order_status_id and is_deleted are only ever submitted on update — a
    # new sales order is always created as "Pending" and not deleted.
    order_status_id: int
    is_deleted: bool = False
    cust_id: int
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    description: str
    related_purchase_order_ids: list[int] = []

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdateSalesOrderDetailsRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if len(lengths) != 1:
            raise ValueError("product_ids, quantities, rates, and tax_percs must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class UpdateSalesOrderDetailsResponse(BaseModel):
    message: str


class OrderStatusListItem(BaseModel):
    id: int
    status_name: str
