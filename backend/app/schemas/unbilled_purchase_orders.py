# Request/response bodies for the unbilled orders module's endpoints.
#
# Deliberately much thinner than schemas/purchase_orders.py: there is no
# tax_kind, no sgst/cgst/igst, no gst_percs and no vendor_invoice_no, because
# an unbilled purchase has no vendor document and no GST behind it (see
# models/unbilled_purchase_orders.py). purchase_order_no is absent from the
# request side too — the backend assigns it.
from datetime import datetime

from pydantic import BaseModel, model_validator


def _check_line_item_arrays(
    product_ids: list[int | None], product_names: list[str], quantities: list[int], rates: list[float]
) -> None:
    lengths = {len(product_ids), len(product_names), len(quantities), len(rates)}
    if len(lengths) > 1:
        raise ValueError("product_ids, product_names, quantities and rates must have the same number of entries")
    if len(product_ids) == 0:
        raise ValueError("at least one line item is required")
    for product_id, product_name in zip(product_ids, product_names):
        # A line says which product it is one of two ways, and has to say it
        # somehow: an id for an unbilled product already on file, or a name
        # for one that isn't yet. The name is what routes/unbilled_orders.py
        # creates the product from — and, since unbilled products are told
        # apart by name, also what it matches an existing one on.
        if product_id is None and not product_name.strip():
            raise ValueError("each line item needs either a product_id or a product_name")


class UnbilledPurchaseOrderLineItems(BaseModel):
    # Parallel arrays, one entry per line item — same shape as
    # CreateNewPurchaseOrderRequest, minus the per-line GST rate.
    #
    # product_ids carries a null on any line whose product is being created
    # by this very request, mirroring ParsePurchaseInvoicePdfResponse's
    # convention for a line the admin hasn't resolved yet. product_names is
    # what fills that gap; on a line that did send an id it is ignored, and
    # the form sends the product's own name there anyway.
    product_ids: list[int | None]
    product_names: list[str]
    quantities: list[int]
    rates: list[float]


class CreateNewUnbilledPurchaseOrderRequest(UnbilledPurchaseOrderLineItems):
    vendor_id: int
    date: datetime
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewUnbilledPurchaseOrderRequest":
        _check_line_item_arrays(self.product_ids, self.product_names, self.quantities, self.rates)
        return self


class CreateNewUnbilledPurchaseOrderResponse(BaseModel):
    message: str
    # No purchase_invoice_id twin to CreateNewPurchaseOrderResponse's: an
    # unbilled purchase raises no invoice, which is what makes it unbilled.
    # The id comes back so the caller can jump to the order it just made.
    id: int
    purchase_order_no: str


class UnbilledPurchaseOrderDetailItem(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    product_ids: list[int]
    # Resolved server-side so the list can render line items without joining
    # the product master itself — the billed side's detail item gets away
    # without this only because its table never shows product names.
    product_names: list[str]
    quantities: list[int]
    rates: list[float]
    total_amount: float
    description: str


class UpdateUnbilledPurchaseOrderDetailsRequest(UnbilledPurchaseOrderLineItems):
    id: int
    vendor_id: int
    date: datetime
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdateUnbilledPurchaseOrderDetailsRequest":
        _check_line_item_arrays(self.product_ids, self.product_names, self.quantities, self.rates)
        return self


class UpdateUnbilledPurchaseOrderDetailsResponse(BaseModel):
    message: str


class UnbilledPurchaseOrderListItem(BaseModel):
    # Lightweight shape for the sales order form's "related unbilled
    # purchases" multiselect, mirroring PurchaseOrderListItem.
    id: int
    purchase_order_no: str
    vendor_name: str


class UnbilledProductListItem(BaseModel):
    # The unbilled products a purchase line can be pointed at without
    # creating a new one. Served from this module rather than read off
    # get_product_details so the form has a list already narrowed to
    # is_unbilled, un-deleted products.
    id: int
    product_name: str
    vendor_rate: float
