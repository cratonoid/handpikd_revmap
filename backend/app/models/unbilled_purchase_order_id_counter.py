# Schema for the #unbilled_purchase_order_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated
# UnbilledPurchaseOrders.id — which is also what its "UPO-<id>" purchase
# order number is built from, so one counter covers both.
from beanie import Document


class UnbilledPurchaseOrderIdCounter(Document):
    id: int
    next_unbilled_purchase_order_id: int

    class Settings:
        name = "unbilled_purchase_order_id_counter"
