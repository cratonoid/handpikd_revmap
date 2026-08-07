# Schema for the #product_image_details collection.
from beanie import Document


class ProductImageDetails(Document):
    id: int
    product_id: int  # FK -> ProductDetails.id
    image_path: str

    class Settings:
        name = "product_image_details"
