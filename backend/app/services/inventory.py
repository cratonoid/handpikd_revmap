# Shared helper for keeping Inventory.quantity and the InventoryHistory
# ledger in sync with purchase/sales orders. Used by routes/orders.py
# (purchase orders) and routes/sales_orders.py.
#
# The InventoryHistory rows carrying a given purchase_order_id/sales_order_id
# are the record of how much stock that order currently has applied to
# #inventory, not an append-only audit log. Editing an order rewrites its
# rows and moves Inventory.quantity by the difference between what it had
# applied and what it applies now, so the ledger and the on-hand quantity
# can never drift apart. Reverting a sales order out of "Delivered" clears
# its rows and credits the stock back the same way.
from datetime import datetime, timezone

from beanie.operators import In

from app.models import Inventory, InventoryHistory, InventoryHistoryIdCounter, InventoryIdCounter, ProductDetails
from app.services.counters import get_next_id

_PURCHASE_TRANSACTION = "purchase"
# Stock bought without a bill — its own transaction type rather than a
# "purchase" row with a different parent id, so the ledger says which kind of
# purchase brought the stock in without anyone having to join back to find
# out. See models/unbilled_purchase_orders.py.
_UNBILLED_PURCHASE_TRANSACTION = "unbilled_purchase"
_SALES_TRANSACTION = "sales"

# Sign a line item's quantity carries when it is applied to stock: a purchase
# adds, a sale removes. Passed to compute_stock_deltas by the two callers.
STOCK_IN = 1
STOCK_OUT = -1


async def get_current_quantities(product_ids: list[int]) -> dict[int, int]:
    # Products with no Inventory row yet (never purchased or sold) are
    # simply absent from the returned dict — callers should treat a missing
    # key as 0 on hand, same convention as routes/inventory.py's
    # get_inventory.
    rows = await Inventory.find(In(Inventory.product_id, product_ids)).to_list()
    return {row.product_id: row.quantity for row in rows}


def totals_by_product(product_ids: list[int], quantities: list[int]) -> dict[int, int]:
    # A product can appear on more than one line item of the same order, so
    # line items are summed per product before any of this reaches
    # #inventory — the ledger still keeps one row per line item.
    totals: dict[int, int] = {}
    for product_id, quantity in zip(product_ids, quantities):
        totals[product_id] = totals.get(product_id, 0) + quantity
    return totals


def _sum_rows_by_product(rows: list[InventoryHistory]) -> dict[int, int]:
    totals: dict[int, int] = {}
    for row in rows:
        totals[row.product_id] = totals.get(row.product_id, 0) + row.quantity
    return totals


async def get_applied_purchase_quantities(purchase_order_id: int) -> dict[int, int]:
    # How much stock this purchase order has already added, per product.
    rows = await InventoryHistory.find(InventoryHistory.purchase_order_id == purchase_order_id).to_list()
    return _sum_rows_by_product(rows)


async def get_applied_unbilled_purchase_quantities(unbilled_purchase_order_id: int) -> dict[int, int]:
    # How much stock this unbilled purchase order has already added, per
    # product. The billed twin above reads the same ledger through a
    # different parent column — see InventoryHistory.unbilled_purchase_order_id
    # for why the two can't share one.
    rows = await InventoryHistory.find(
        InventoryHistory.unbilled_purchase_order_id == unbilled_purchase_order_id
    ).to_list()
    return _sum_rows_by_product(rows)


async def get_applied_sales_quantities(sales_order_id: int) -> dict[int, int]:
    # How much stock this sales order has already removed, per product. Empty
    # for an order that has never reached "Delivered", or that was moved back
    # out of it.
    rows = await InventoryHistory.find(InventoryHistory.sales_order_id == sales_order_id).to_list()
    return _sum_rows_by_product(rows)


def compute_stock_deltas(applied: dict[int, int], target: dict[int, int], direction: int) -> dict[int, int]:
    # Signed change to make to Inventory.quantity per product, covering every
    # product on either side so that a product dropped from an order in an
    # edit still gets its stock unwound. Products whose quantity is unchanged
    # are left out entirely.
    product_ids = set(applied) | set(target)
    return {
        product_id: direction * (target.get(product_id, 0) - applied.get(product_id, 0))
        for product_id in product_ids
        if target.get(product_id, 0) != applied.get(product_id, 0)
    }


async def find_stock_shortfalls(stock_deltas: dict[int, int]) -> list[tuple[int, int, int]]:
    # (product_id, on hand, delta) for every product the given deltas would
    # take below zero. Callers reject the whole operation on a non-empty
    # result rather than letting #inventory go negative.
    reductions = [product_id for product_id, delta in stock_deltas.items() if delta < 0]
    if not reductions:
        return []

    on_hand = await get_current_quantities(reductions)
    return [
        (product_id, on_hand.get(product_id, 0), stock_deltas[product_id])
        for product_id in reductions
        if on_hand.get(product_id, 0) + stock_deltas[product_id] < 0
    ]


async def _set_product_visibility(product_id: int, is_visible: bool) -> None:
    product = await ProductDetails.get(product_id)
    if product is None:
        return

    # An unbilled product must never be shown on the storefront, and
    # restocking one is the only way it could have been: the caller below
    # turns visibility ON whenever stock arrives, which for these would put
    # goods bought off a local market — no HSN, no catalogue entry, no
    # selling price yet — in front of customers. Hiding one on sell-out is
    # still allowed through (it is already hidden, so it is a no-op), because
    # the rule is about surfacing them, not about the flag's value.
    if is_visible and product.is_unbilled:
        return

    if product.is_visible != is_visible:
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


async def _apply_stock_deltas(stock_deltas: dict[int, int]) -> None:
    for product_id, delta in stock_deltas.items():
        if delta:
            await _adjust_inventory_quantity(product_id, delta)


async def _record_inventory_transaction(
    product_id: int,
    transaction_type: str,
    quantity: int,
    *,
    purchase_order_id: int | None = None,
    unbilled_purchase_order_id: int | None = None,
    sales_order_id: int | None = None,
) -> None:
    history_id = await get_next_id(InventoryHistoryIdCounter, "next_inventory_history_id", InventoryHistory)
    await InventoryHistory(
        id=history_id,
        product_id=product_id,
        transaction_type=transaction_type,
        quantity=quantity,
        purchase_order_id=purchase_order_id,
        unbilled_purchase_order_id=unbilled_purchase_order_id,
        sales_order_id=sales_order_id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ).insert()


async def apply_purchase_order_stock(
    purchase_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    stock_deltas: dict[int, int],
) -> None:
    # Moves stock by stock_deltas, then replaces this order's ledger rows
    # with one row per current line item. stock_deltas is passed in rather
    # than recomputed so that what gets applied is exactly what the caller
    # validated against going negative.
    await _apply_stock_deltas(stock_deltas)
    await InventoryHistory.find(InventoryHistory.purchase_order_id == purchase_order_id).delete()
    for product_id, quantity in zip(product_ids, quantities):
        await _record_inventory_transaction(
            product_id, _PURCHASE_TRANSACTION, quantity, purchase_order_id=purchase_order_id
        )


async def apply_unbilled_purchase_order_stock(
    unbilled_purchase_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    stock_deltas: dict[int, int],
) -> None:
    # Exactly apply_purchase_order_stock's behaviour, filed under this
    # order's own parent column and transaction type. Unbilled stock is real
    # stock: it lands in the same #inventory quantities, is checked against
    # the same shortfall rules, and is sold off the same sales orders — the
    # only thing missing from the purchase is the paperwork.
    await _apply_stock_deltas(stock_deltas)
    await InventoryHistory.find(
        InventoryHistory.unbilled_purchase_order_id == unbilled_purchase_order_id
    ).delete()
    for product_id, quantity in zip(product_ids, quantities):
        await _record_inventory_transaction(
            product_id,
            _UNBILLED_PURCHASE_TRANSACTION,
            quantity,
            unbilled_purchase_order_id=unbilled_purchase_order_id,
        )


async def apply_sales_order_stock(
    sales_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    stock_deltas: dict[int, int],
) -> None:
    # Mirror of apply_purchase_order_stock for the sales side. Only called
    # once a sales order is in a status that holds stock out of #inventory —
    # see routes/sales_orders.py's _STOCK_DEDUCTED_STATUS_NAMES.
    await _apply_stock_deltas(stock_deltas)
    await InventoryHistory.find(InventoryHistory.sales_order_id == sales_order_id).delete()
    for product_id, quantity in zip(product_ids, quantities):
        await _record_inventory_transaction(product_id, _SALES_TRANSACTION, quantity, sales_order_id=sales_order_id)


async def clear_sales_order_stock(sales_order_id: int) -> None:
    # Credits back everything this sales order is currently holding out of
    # stock and drops its ledger rows — used when an order moves back out of
    # "Delivered"/"Completed", or is soft-deleted while in one of them. A
    # no-op for an order that never had stock applied.
    applied_quantities = await get_applied_sales_quantities(sales_order_id)
    if not applied_quantities:
        return

    await _apply_stock_deltas(applied_quantities)
    await InventoryHistory.find(InventoryHistory.sales_order_id == sales_order_id).delete()
