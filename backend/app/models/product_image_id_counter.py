# Schema for the #product_image_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated ProductImageDetails.id.
from beanie import Document


class ProductImageIdCounter(Document):
    id: int
    next_product_image_id: int

    class Settings:
        name = "product_image_id_counter"
