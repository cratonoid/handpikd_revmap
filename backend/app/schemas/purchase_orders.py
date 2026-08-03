# Request/response bodies for the orders module's endpoints.
from pydantic import BaseModel, model_validator


class CreateNewPurchaseOrderRequest(BaseModel):
    purchase_order_no: int
    vendor_id: int
    # Parallel arrays, one entry per line item (mirrors AddVendorDetailsRequest's
    # contact_name/contact_phone pairing). product_ids must all belong to
    # vendor_id — a purchase order is placed with a single vendor.
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    sgst_amount: float | None = None
    cgst_amount: float | None = None
    igst_amount: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "CreateNewPurchaseOrderRequest":
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class CreateNewPurchaseOrderResponse(BaseModel):
    message: str


class PurchaseOrderDetailItem(BaseModel):
    id: int
    purchase_order_no: int
    vendor_id: int
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    total_amount_before_tax: float
    sgst_amount: float | None = None
    cgst_amount: float | None = None
    igst_amount: float | None = None
    total_amount_after_tax: float
    description: str


class UpdatePurchaseOrderDetailsRequest(BaseModel):
    id: int
    purchase_order_no: int
    vendor_id: int
    product_ids: list[int]
    quantities: list[int]
    rates: list[float]
    sgst_amount: float | None = None
    cgst_amount: float | None = None
    igst_amount: float | None = None
    description: str

    @model_validator(mode="after")
    def _check_line_items_match(self) -> "UpdatePurchaseOrderDetailsRequest":
        if len(self.product_ids) != len(self.quantities) or len(self.product_ids) != len(self.rates):
            raise ValueError("product_ids, quantities, and rates must have the same number of entries")
        if len(self.product_ids) == 0:
            raise ValueError("at least one line item is required")
        return self


class UpdatePurchaseOrderDetailsResponse(BaseModel):
    message: str
