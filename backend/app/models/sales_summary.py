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
    # Free-text remark the admin can leave against this one line on the
    # order form ("print on both sides", "deliver separately") — optional,
    # so a line without one is stored as "", which is also what every row
    # written before this field existed reads as. Purely informational: it
    # plays no part in the line's totals, stock or costing.
    note: str = ""

    class Settings:
        name = "sales_summary"
