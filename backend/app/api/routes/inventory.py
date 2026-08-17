# Inventory module: read-only visibility into current stock (#inventory)
# and the InventoryHistory ledger, both written by routes/orders.py and
# routes/sales_orders.py (see app/services/inventory.py). Purchase orders
# move stock as soon as they are created or edited; sales orders only do so
# once they reach "Delivered". Restricted to admins, matching the rest of
# the admin API.
from fastapi import APIRouter, Depends

from app.api.routes.admin import require_admin
from app.models import Inventory, InventoryHistory, ProductDetails, User
from app.schemas.inventory import InventoryHistoryItem, InventoryItem

router = APIRouter(prefix="/admin", tags=["inventory"])


@router.get("/get_inventory", response_model=list[InventoryItem])
async def get_inventory(
    _: User | None = Depends(require_admin),
) -> list[InventoryItem]:
    # One row per product with stock on hand. A product with no purchase/sale
    # history yet, or one that's been sold down to 0 (see
    # services/inventory.py's _adjust_inventory_quantity, which drops the
    # Inventory row at 0), has no Inventory row and is left out — this view
    # is meant to show what's actually in stock, not every product ever
    # created (see schemas/inventory.py).
    products = await ProductDetails.find_all().to_list()
    inventory_rows = await Inventory.find_all().to_list()
    quantity_by_product_id = {row.product_id: row.quantity for row in inventory_rows}
    products_by_id = {product.id: product for product in products}

    return [
        InventoryItem(
            product_id=row.product_id,
            product_name=products_by_id[row.product_id].product_name,
            hsn_code=products_by_id[row.product_id].hsn_code,
            quantity=row.quantity,
        )
        for row in inventory_rows
        if row.product_id in products_by_id and row.quantity != 0
    ]


@router.get("/get_inventory_history", response_model=list[InventoryHistoryItem])
async def get_inventory_history(
    _: User | None = Depends(require_admin),
) -> list[InventoryHistoryItem]:
    history = await InventoryHistory.find_all().to_list()
    return [
        InventoryHistoryItem(
            id=entry.id,
            product_id=entry.product_id,
            transaction_type=entry.transaction_type,
            quantity=entry.quantity,
            purchase_order_id=entry.purchase_order_id,
            sales_order_id=entry.sales_order_id,
            created_at=entry.created_at,
        )
        for entry in history
    ]
