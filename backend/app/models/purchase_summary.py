# Schema for the #purchase_summary collection.
from beanie import Document


class PurchaseSummary(Document):
    id: int
    purchase_order_id: int  # FK -> PurchaseOrders.id
    product_id: int  # FK -> ProductDetails.id
    quantity: int
    rate: float

    class Settings:
        name = "purchase_summary"
