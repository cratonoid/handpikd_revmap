# Request/response bodies for the inventory module's endpoints.
from datetime import datetime

from pydantic import BaseModel


class InventoryItem(BaseModel):
    # Keyed by product_id rather than the #inventory collection's own id —
    # get_inventory returns one row per product (see routes/inventory.py),
    # including products that have never had a purchase/sale and so have no
    # underlying Inventory document yet (quantity defaults to 0 for those).
    product_id: int
    product_name: str
    hsn_code: str
    quantity: int


class InventoryHistoryItem(BaseModel):
    id: int
    product_id: int
    transaction_type: str
    quantity: int
    purchase_order_id: int | None = None
    sales_order_id: int | None = None
    created_at: datetime
