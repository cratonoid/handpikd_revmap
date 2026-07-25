# Schema for the #sales_summary collection.
from beanie import Document


class SalesSummary(Document):
    id: int
    product_id: int  # FK -> ProductDetails.id
    quantity: int

    class Settings:
        name = "sales_summary"
