# Schema for the #order_no_counter_master collection.
from pydantic import BaseModel


class OrderNoCounterMaster(BaseModel):
    id: int
    next_order_no: int
