# Schema for the #sales_order_id_counter collection.
from beanie import Document


class SalesOrderIdCounter(Document):
    id: int
    next_sales_order_id: int

    class Settings:
        name = "sales_order_id_counter"
