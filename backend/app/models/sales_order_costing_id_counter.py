# Schema for the #sales_order_costing_id_counter collection.
from beanie import Document


class SalesOrderCostingIdCounter(Document):
    id: int
    next_sales_order_costing_id: int

    class Settings:
        name = "sales_order_costing_id_counter"
