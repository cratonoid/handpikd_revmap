# Schema for the #purchase_summary collection.
from pydantic import BaseModel


class PurchaseSummary(BaseModel):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int
