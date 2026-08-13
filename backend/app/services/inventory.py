# Shared helper for keeping Inventory.quantity and the InventoryHistory
# ledger in sync with purchase/sales order creation. Used by
# routes/orders.py (purchase orders) and routes/sales_orders.py.
from datetime import datetime, timezone

from beanie.operators import In

from app.models import Inventory, InventoryHistory, InventoryHistoryIdCounter, InventoryIdCounter, ProductDetails
from app.services.counters import get_next_id

_PURCHASE_TRANSACTION = "purchase"
_SALES_TRANSACTION = "sales"


async def get_current_quantities(product_ids: list[int]) -> dict[int, int]:
    # Products with no Inventory row yet (never purchased or sold) are
    # simply absent from the returned dict — callers should treat a missing
    # key as 0 on hand, same convention as routes/inventory.py's
    # get_inventory.
    rows = await Inventory.find(In(Inventory.product_id, product_ids)).to_list()
    return {row.product_id: row.quantity for row in rows}


async def _set_product_visibility(product_id: int, is_visible: bool) -> None:
    product = await ProductDetails.get(product_id)
    if product is not None and product.is_visible != is_visible:
        product.is_visible = is_visible
        await product.save()


async def _adjust_inventory_quantity(product_id: int, delta: int) -> None:
    inventory = await Inventory.find_one(Inventory.product_id == product_id)
    if inventory is None:
        new_quantity = max(delta, 0)
        if new_quantity > 0:
            inventory_id = await get_next_id(InventoryIdCounter, "next_inventory_id", Inventory)
            await Inventory(id=inventory_id, product_id=product_id, quantity=new_quantity).insert()
            await _set_product_visibility(product_id, True)
        return

    inventory.quantity += delta
    if inventory.quantity <= 0:
        # Out of stock: drop the inventory row and hide the product from the
        # catalogue, but keep ProductDetails so it can resurface on restock.
        await inventory.delete()
        await _set_product_visibility(product_id, False)
    else:
        await inventory.save()
        if delta > 0:
            await _set_product_visibility(product_id, True)


async def _record_inventory_transaction(
    product_id: int,
    transaction_type: str,
    quantity: int,
    *,
    purchase_order_id: int | None = None,
    sales_order_id: int | None = None,
) -> None:
    history_id = await get_next_id(InventoryHistoryIdCounter, "next_inventory_history_id", InventoryHistory)
    await InventoryHistory(
        id=history_id,
        product_id=product_id,
        transaction_type=transaction_type,
        quantity=quantity,
        purchase_order_id=purchase_order_id,
        sales_order_id=sales_order_id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ).insert()


async def record_purchase_received(purchase_order_id: int, product_ids: list[int], quantities: list[int]) -> None:
    # A purchase adds stock — one InventoryHistory row per line item, each
    # increasing that product's Inventory.quantity by the purchased amount.
    for product_id, quantity in zip(product_ids, quantities):
        await _adjust_inventory_quantity(product_id, quantity)
        await _record_inventory_transaction(
            product_id, _PURCHASE_TRANSACTION, quantity, purchase_order_id=purchase_order_id
        )


async def record_sale_fulfilled(sales_order_id: int, product_ids: list[int], quantities: list[int]) -> None:
    # A sale removes stock. This function itself doesn't floor at 0 or
    # re-check availability — routes/sales_orders.py's create_new_sales_order
    # calls get_current_quantities up front and rejects the order before
    # ever reaching here if any line item would take a product negative.
    for product_id, quantity in zip(product_ids, quantities):
        await _adjust_inventory_quantity(product_id, -quantity)
        await _record_inventory_transaction(product_id, _SALES_TRANSACTION, quantity, sales_order_id=sales_order_id)
