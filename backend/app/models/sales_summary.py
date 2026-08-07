# Schema for the #sales_summary collection.
from beanie import Document


class SalesSummary(Document):
    id: int
    sales_order_id: int  # FK -> SalesOrders.id
    product_id: int  # FK -> ProductDetails.id
    quantity: int
    rate: float
    tax_perc: float
    tax_amount: float
    total: float

    class Settings:
        name = "sales_summary"
