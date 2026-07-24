# Schema for the #inventory collection.
from pydantic import BaseModel


class Inventory(BaseModel):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int
