# Schema for the #inventory collection.
from beanie import Document


class Inventory(Document):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int

    class Settings:
        name = "inventory"
