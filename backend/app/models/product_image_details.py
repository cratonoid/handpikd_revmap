# Schema for the #product_image_details collection.
from pydantic import BaseModel


class ProductImageDetails(BaseModel):
    id: int
    product_id: int  # FK -> ProductDetails.id
    image_path: str
