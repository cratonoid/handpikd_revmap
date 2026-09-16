# Request/response bodies for the sales orders module's endpoints.
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class CreateNewSalesOrderRequest(BaseModel):
    cust_id: int
    date: datetime
    # Parallel arrays, one entry per line item (mirrors
    # CreateNewPurchaseOrderRequest's product_ids/quantities/rates, plus
    # tax_percs since sales order tax is captured per line item rather than
    # as a flat order-level SGST/CGST/IGST amount).
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    # Optional per-line remark, parallel to the arrays above — see
    # SalesSummary.note. A line without one sends ""; a client that omits
    # the whole list gets "" on every line.
    notes: list[str] | None = None
    # Flat discount off the order's whole net (pre-tax) amount — see
    # SalesOrders.overall_discount. Optional: an order without one submits 0.
    overall_discount: float = Field(default=0.0, ge=0)
    # Delivery charged to the customer, plus the GST % it carries — see
    # SalesOrders.delivery_charge. Both optional: an order with no delivery
    # submits 0 for each, which is exactly what an order raised before this
    # existed reads as.
    delivery_charge: float = Field(default=0.0, ge=0)
    delivery_tax_perc: float = Field(default=0.0, ge=0)
    description: str
    # Optional: purchase order(s) this sales order is fulfilled from.
    related_purchase_order_ids: list[int] = []
    # Optional: unbilled purchase order(s) it is fulfilled from — a separate
    # list because the two are different collections with overlapping ids.
    # See SalesOrders.related_unbilled_purchase_order_ids.
    related_unbilled_purchase_order_ids: list[int] = []

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewSalesOrderRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if self.notes is not None:
            lengths.add(len(self.notes))
        if len(lengths) != 1:
            raise ValueError(
                "product_ids, quantities, rates, tax_percs, and notes must have the same number of entries"
            )
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
    date: datetime
    # SalesSummary.id of each line, parallel to the arrays below. The edit
    # form sends these back as line_item_ids so an edit updates the same rows
    # in place — the "Add details" costing hangs off them (see
    # models/sales_order_costing.py).
    line_item_ids: list[int]
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    # Per-line remark, "" where none was left — see SalesSummary.note.
    notes: list[str]
    overall_discount: float
    delivery_charge: float
    delivery_tax_perc: float
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    related_purchase_order_ids: list[int]
    related_unbilled_purchase_order_ids: list[int] = []
    # See SalesOrders.po_updated_flag — true when a related purchase order
    # was edited since this sales order was last saved.
    po_updated_flag: bool
    is_deleted: bool


class UpdateSalesOrderDetailsRequest(BaseModel):
    id: int
    # order_status_id and is_deleted are only ever submitted on update — a
    # new sales order is always created as "New" and not deleted.
    order_status_id: int
    is_deleted: bool = False
    cust_id: int
    date: datetime
    # Parallel to product_ids: the SalesSummary.id each line came from (as
    # returned by get_sales_order_details), or None for a line added on the
    # form. Lets the edit update existing rows in place so their ids — and
    # the costing keyed on them — survive; a row whose id is not sent back is
    # deleted. Optional: a client that omits the whole list gets a
    # best-effort positional match instead (see update_sales_order_details).
    line_item_ids: list[int | None] | None = None
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    tax_percs: list[float]
    # Optional per-line remark, parallel to the arrays above — see
    # SalesSummary.note. A line without one sends ""; a client that omits
    # the whole list gets "" on every line.
    notes: list[str] | None = None
    # Flat discount off the order's whole net (pre-tax) amount — see
    # SalesOrders.overall_discount. Optional: an order without one submits 0.
    overall_discount: float = Field(default=0.0, ge=0)
    # Delivery charged to the customer, plus the GST % it carries — see
    # SalesOrders.delivery_charge. Both optional: an order with no delivery
    # submits 0 for each, which is exactly what an order raised before this
    # existed reads as.
    delivery_charge: float = Field(default=0.0, ge=0)
    delivery_tax_perc: float = Field(default=0.0, ge=0)
    description: str
    related_purchase_order_ids: list[int] = []
    related_unbilled_purchase_order_ids: list[int] = []

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdateSalesOrderDetailsRequest":
        lengths = {len(self.product_ids), len(self.quantities), len(self.rates), len(self.tax_percs)}
        if self.line_item_ids is not None:
            lengths.add(len(self.line_item_ids))
        if self.notes is not None:
            lengths.add(len(self.notes))
        if len(lengths) != 1:
            raise ValueError(
                "line_item_ids, product_ids, quantities, rates, tax_percs, and notes "
                "must have the same number of entries"
            )
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        if self.line_item_ids is not None:
            sent_ids = [line_item_id for line_item_id in self.line_item_ids if line_item_id is not None]
            if len(sent_ids) != len(set(sent_ids)):
                raise ValueError("each line item id may only appear once")
        return self


class UpdateSalesOrderDetailsResponse(BaseModel):
    message: str


# The sales orders table's inline status dropdown. Deliberately NOT the full
# UpdateSalesOrderDetailsRequest with one field swapped: that endpoint
# rewrites #sales_summary, re-derives the totals, and clears po_updated_flag,
# none of which an admin flipping a status in a table row is asking for.
class UpdateSalesOrderStatusRequest(BaseModel):
    id: int
    order_status_id: int


class UpdateSalesOrderStatusResponse(BaseModel):
    message: str


class OrderStatusListItem(BaseModel):
    id: int
    status_name: str
