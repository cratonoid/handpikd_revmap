# Schema for the #order_status_master collection.
from pydantic import BaseModel


class OrderStatusMaster(BaseModel):
    id: int
    status_name: str
