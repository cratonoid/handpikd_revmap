# Schema for the #purchase_orders collection.
from pydantic import BaseModel


class PurchaseOrders(BaseModel):
    id: int
    purchase_order_no: int
    vendor_id: int  # FK -> VendorDetails.id
    total_amount_before_tax: float
    sgst_amount: float | None = None
    cgst_amount: float | None = None
    igst_amount: float | None = None
    total_amount_after_tax: float
    description: str
