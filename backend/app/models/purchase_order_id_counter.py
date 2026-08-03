# Schema for the #purchase_order_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated PurchaseOrders.id.
from beanie import Document


class PurchaseOrderIdCounter(Document):
    id: int
    next_purchase_order_id: int

    class Settings:
        name = "purchase_order_id_counter"
