# Schema for the #inventory_history collection.
from datetime import datetime

from beanie import Document


class InventoryHistory(Document):
    id: int
    product_id: int  # FK -> ProductDetails.id
    transaction_type: str  # "purchase" | "unbilled_purchase" | "sales"
    quantity: int  # units moved by this transaction (always positive; sign is implied by transaction_type)
    purchase_order_id: int | None = None  # FK -> PurchaseOrders.id
    # FK -> UnbilledPurchaseOrders.id. A third nullable parent alongside the
    # two above rather than a reuse of purchase_order_id: the two live in
    # different collections and their ids overlap, so one column could not
    # say which order a row came from. Exactly one of the three is set.
    unbilled_purchase_order_id: int | None = None
    sales_order_id: int | None = None  # FK -> SalesOrders.id
    created_at: datetime

    class Settings:
        name = "inventory_history"
