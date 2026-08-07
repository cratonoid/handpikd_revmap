# Schema for the #product_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated ProductDetails.id.
from beanie import Document


class ProductIdCounter(Document):
    id: int
    next_product_id: int

    class Settings:
        name = "product_id_counter"
