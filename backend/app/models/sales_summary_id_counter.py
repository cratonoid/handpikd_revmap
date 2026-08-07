# Schema for the #sales_summary_id_counter collection.
from beanie import Document


class SalesSummaryIdCounter(Document):
    id: int
    next_sales_summary_id: int

    class Settings:
        name = "sales_summary_id_counter"
