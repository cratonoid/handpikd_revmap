# Schema for the #order_status_master collection.
from beanie import Document


class OrderStatusMaster(Document):
    id: int
    status_name: str

    class Settings:
        name = "order_status_master"
