# Schema for the #printing_purchase_order_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated
# PrintingPurchaseOrders.id.
from beanie import Document


class PrintingPurchaseOrderIdCounter(Document):
    id: int
    next_printing_purchase_order_id: int

    class Settings:
        name = "printing_purchase_order_id_counter"
