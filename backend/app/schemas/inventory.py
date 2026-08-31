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
    # Splits the inventory page's Billed/Unbilled views. Stock bought without
    # a bill lives in the same #inventory collection and moves through the
    # same helpers — the only thing separating the two lists is this flag on
    # the product (see ProductDetails.is_unbilled), which is also why an
    # unbilled row's hsn_code above is always "".
    is_unbilled: bool = False


class InventoryHistoryItem(BaseModel):
    id: int
    product_id: int
    # "purchase" | "unbilled_purchase" | "sales" — see InventoryHistory.
    transaction_type: str
    quantity: int
    purchase_order_id: int | None = None
    # Set instead of purchase_order_id on an "unbilled_purchase" row; the two
    # name orders in different collections, so the history tab has to resolve
    # each against its own list. See InventoryHistory.unbilled_purchase_order_id.
    unbilled_purchase_order_id: int | None = None
    sales_order_id: int | None = None
    created_at: datetime
