# Schema for the #order_no_counter_master collection.
from beanie import Document


class OrderNoCounterMaster(Document):
    id: int
    next_order_no: int

    class Settings:
        name = "order_no_counter_master"
