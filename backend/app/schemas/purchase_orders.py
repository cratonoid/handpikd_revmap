# Request/response bodies for the orders module's endpoints.
from datetime import datetime

from pydantic import BaseModel, model_validator


def _check_gst_combo(sgst_perc: float | None, cgst_perc: float | None, igst_perc: float | None) -> None:
    # Indian GST: a purchase is taxed as EITHER sgst+cgst (intra-state) OR
    # igst alone (inter-state) — never both at once.
    if (sgst_perc or cgst_perc) and igst_perc:
        raise ValueError("use either SGST + CGST or IGST, not both")


class CreateNewPurchaseOrderRequest(BaseModel):
    purchase_order_no: str
    vendor_id: int
    date: datetime
    # Parallel arrays, one entry per line item (mirrors AddVendorDetailsRequest's
    # contact_name/contact_phone pairing). product_ids must all belong to
    # vendor_id — a purchase order is placed with a single vendor.
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    # Percentages applied to the line items' subtotal — see _compute_totals
    # in routes/orders.py.
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewPurchaseOrderRequest":
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self

    @model_validator(mode="after")
    def _check_gst_combo(self) -> "CreateNewPurchaseOrderRequest":
        _check_gst_combo(self.sgst_perc, self.cgst_perc, self.igst_perc)
        return self


class CreateNewPurchaseOrderResponse(BaseModel):
    message: str


class PurchaseOrderDetailItem(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    total_amount_before_tax: float
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_after_tax: float
    description: str


class UpdatePurchaseOrderDetailsRequest(BaseModel):
    id: int
    purchase_order_no: str
    vendor_id: int
    date: datetime
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdatePurchaseOrderDetailsRequest":
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self

    @model_validator(mode="after")
    def _check_gst_combo(self) -> "UpdatePurchaseOrderDetailsRequest":
        _check_gst_combo(self.sgst_perc, self.cgst_perc, self.igst_perc)
        return self


class UpdatePurchaseOrderDetailsResponse(BaseModel):
    message: str


class PurchaseOrderListItem(BaseModel):
    # Lightweight id+PO no.+vendor name shape for the sales order form's
    # "related purchase orders" multiselect — see get_purchase_order_list in
    # routes/orders.py. PurchaseOrders has no is_deleted, so unlike
    # VendorListItem/CustomerListItem this always covers every order.
    id: int
    purchase_order_no: str
    vendor_name: str
