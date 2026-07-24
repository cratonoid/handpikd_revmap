# Schema for the #product_details collection.
from pydantic import BaseModel


class ProductDetails(BaseModel):
    id: int
    product_name: str
    hsn_code: str
    vendor_id: int  # FK -> VendorDetails.id
    vendor_rate: float
    actual_price: float
    discounted_price: float
    gst_perc: float
    category_ids: list[int]  # FK -> Category.id (array)
    moq: int
    description: str
    is_visible: bool
