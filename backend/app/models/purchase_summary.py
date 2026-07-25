# Schema for the #purchase_summary collection.
from beanie import Document


class PurchaseSummary(Document):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int

    class Settings:
        name = "purchase_summary"
