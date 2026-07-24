# Schema for the #sales_summary collection.
from pydantic import BaseModel


class SalesSummary(BaseModel):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int
