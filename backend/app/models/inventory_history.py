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
    # The date the stock actually moved — copied from the parent order's own
    # `date` field, which the admin sets on the order form. This, not
    # created_at, is what the inventory history tab shows: a purchase entered
    # today for goods bought last month belongs on last month's date, and
    # correcting the order's date has to move its ledger rows with it.
    #
    # Rows written before this field existed are backfilled from their parent
    # order by _backfill_inventory_history_transaction_date in core/db.py.
    transaction_date: datetime
    # When this row was WRITTEN, which is not the same thing: an order's rows
    # are deleted and rewritten on every edit (see apply_purchase_order_stock
    # below), so this tracks the last time the ledger was touched for that
    # order, and nothing user-facing reads it.
    created_at: datetime

    class Settings:
        name = "inventory_history"
