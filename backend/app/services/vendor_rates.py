# Keeps ProductDetails.vendor_rate in step with what was last paid.
#
# vendor_rate is where #sales_order_costing seeds a line's purchase rate the
# first time an order's details sheet is opened (see get_sales_order_costing
# in routes/sales_orders.py). Without this, it only ever held the rate typed
# on the product form — so a product re-bought at a new price kept costing
# sales orders at the old one.
#
# "Last paid" is the rate on the most recently dated purchase line, billed or
# unbilled, rather than whatever order happened to be saved last: editing an
# old purchase order must not drag the rate back to an old price.
from beanie.operators import In

from app.models import (
    ProductDetails,
    PurchaseOrders,
    PurchaseSummary,
    UnbilledPurchaseOrders,
    UnbilledPurchaseSummary,
)


async def sync_vendor_rates_from_purchases(product_ids: list[int]) -> None:
    product_ids = list(set(product_ids))
    if not product_ids:
        return

    # (date, order kind, order id, line id) -> rate, per product; the tuple
    # gives a stable "latest" when two orders share a date.
    latest: dict[int, tuple[tuple, float]] = {}

    def consider(product_id: int, key: tuple, rate: float) -> None:
        if rate <= 0:
            return
        current = latest.get(product_id)
        if current is None or key > current[0]:
            latest[product_id] = (key, rate)

    billed_lines = await PurchaseSummary.find(In(PurchaseSummary.product_id, product_ids)).to_list()
    if billed_lines:
        orders = await PurchaseOrders.find(
            In(PurchaseOrders.id, list({line.purchase_order_id for line in billed_lines}))
        ).to_list()
        dates = {order.id: order.date for order in orders}
        for line in billed_lines:
            date = dates.get(line.purchase_order_id)
            if date is not None:
                consider(line.product_id, (date, 0, line.purchase_order_id, line.id), line.rate)

    unbilled_lines = await UnbilledPurchaseSummary.find(
        In(UnbilledPurchaseSummary.product_id, product_ids)
    ).to_list()
    if unbilled_lines:
        orders = await UnbilledPurchaseOrders.find(
            In(UnbilledPurchaseOrders.id, list({line.unbilled_purchase_order_id for line in unbilled_lines}))
        ).to_list()
        dates = {order.id: order.date for order in orders}
        for line in unbilled_lines:
            date = dates.get(line.unbilled_purchase_order_id)
            if date is not None:
                consider(line.product_id, (date, 1, line.unbilled_purchase_order_id, line.id), line.rate)

    if not latest:
        return

    products = await ProductDetails.find(In(ProductDetails.id, list(latest))).to_list()
    for product in products:
        rate = latest[product.id][1]
        if product.vendor_rate != rate:
            product.vendor_rate = rate
            await product.save()
