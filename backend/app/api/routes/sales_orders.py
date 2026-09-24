# Sales orders module: endpoints for placing sales orders against a
# customer's product picks, restricted to admins (bypassed entirely when
# settings.auth_enabled is False, matching require_admin in routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    OrderNoCounterMaster,
    OrderStatusMaster,
    PrintingCost,
    ProductDetails,
    PurchaseOrders,
    SalesOrderCosting,
    SalesOrderCostingIdCounter,
    SalesOrderIdCounter,
    SalesOrders,
    SalesSummary,
    SalesSummaryIdCounter,
    UnbilledPurchaseOrders,
    User,
)
from app.schemas.sales_order_costing import (
    CostingReportPrinting,
    PrintingCostItem,
    SalesOrderCostingLine,
    SalesOrderCostingReportRow,
    SalesOrderCostingResponse,
    UpdateSalesOrderCostingRequest,
    UpdateSalesOrderCostingResponse,
)
from app.schemas.sales_orders import (
    CreateNewSalesOrderRequest,
    CreateNewSalesOrderResponse,
    OrderStatusListItem,
    SalesOrderDetailItem,
    UpdateSalesOrderDetailsRequest,
    UpdateSalesOrderDetailsResponse,
    UpdateSalesOrderStatusRequest,
    UpdateSalesOrderStatusResponse,
)
from app.services.counters import get_next_id
from app.services.invoice_totals import refresh_invoice_totals_for_sales_orders
from app.services.inventory import (
    STOCK_OUT,
    apply_sales_order_stock,
    clear_sales_order_stock,
    compute_stock_deltas,
    find_stock_shortfalls,
    stock_shortfall_labels,
    get_applied_sales_quantities,
    totals_by_product,
)

router = APIRouter(prefix="/admin", tags=["sales_orders"])

_NEW_STATUS_NAME = "New"

# Stock only leaves #inventory once a sales order reaches "Delivered", and
# stays out through "Completed" downstream of it. "New" and "Processing"
# record intent only — an order can be raised and edited for more than is on
# hand without moving stock, and availability is checked at the point of
# delivery instead (see _reject_stock_going_negative).
_STOCK_DEDUCTED_STATUS_NAMES = ("Delivered", "Completed")


async def _validate_customer_exists(cust_id: int) -> None:
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")


async def _validate_products_exist(product_ids: list[int], reject_deleted: bool = False) -> None:
    # reject_deleted is on for creates only. A soft-deleted product must not
    # be pickable on something new (it isn't offered by the frontend's picker
    # either — see the isDeleted filter in the form modals), but an existing
    # document that already lists one still has to be editable, so updates
    # only check that the product exists at all.
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in product_ids:
        if product_id not in products_by_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if reject_deleted and products_by_id[product_id].is_deleted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"product {product_id} has been deleted"
            )


async def _validate_purchase_orders_exist(purchase_order_ids: list[int]) -> None:
    if not purchase_order_ids:
        return
    orders = await PurchaseOrders.find(In(PurchaseOrders.id, purchase_order_ids)).to_list()
    found_ids = {order.id for order in orders}
    for purchase_order_id in purchase_order_ids:
        if purchase_order_id not in found_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"purchase order {purchase_order_id} not found"
            )


async def _validate_unbilled_purchase_orders_exist(unbilled_purchase_order_ids: list[int]) -> None:
    # The twin of _validate_purchase_orders_exist for the other collection.
    # UnbilledPurchaseOrders has no is_deleted either, so this likewise
    # covers every order.
    if not unbilled_purchase_order_ids:
        return
    orders = await UnbilledPurchaseOrders.find(
        In(UnbilledPurchaseOrders.id, unbilled_purchase_order_ids)
    ).to_list()
    found_ids = {order.id for order in orders}
    for unbilled_purchase_order_id in unbilled_purchase_order_ids:
        if unbilled_purchase_order_id not in found_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"unbilled purchase order {unbilled_purchase_order_id} not found",
            )


async def _reject_stock_going_negative(stock_deltas: dict[int, int]) -> None:
    # Reached when an order is being marked delivered, or when a delivered
    # order's line items are edited upwards — either way the extra stock has
    # to actually exist. The delta is what this change takes out on top of
    # whatever the order already holds, so re-saving a delivered order
    # unchanged can never trip this.
    shortfalls = await find_stock_shortfalls(stock_deltas)
    if not shortfalls:
        return

    labels = await stock_shortfall_labels(shortfalls)
    details = ", ".join(
        f"{labels[product_id]} (on hand {on_hand}, needs {-delta} more)"
        for product_id, on_hand, delta in shortfalls
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"insufficient stock for: {details}",
    )


async def _validate_order_status_exists(order_status_id: int) -> None:
    order_status = await OrderStatusMaster.get(order_status_id)
    if order_status is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="order status not found")


async def _get_new_status_id() -> int:
    new_status = await OrderStatusMaster.find_one(OrderStatusMaster.status_name == _NEW_STATUS_NAME)
    if new_status is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="order statuses not seeded")
    return new_status.id


async def _get_stock_deducted_status_ids() -> set[int]:
    statuses = await OrderStatusMaster.find(
        In(OrderStatusMaster.status_name, list(_STOCK_DEDUCTED_STATUS_NAMES))
    ).to_list()
    if len(statuses) != len(_STOCK_DEDUCTED_STATUS_NAMES):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="order statuses not seeded")
    return {status_row.id for status_row in statuses}


def _allocate_line_discounts(
    discount_by_product: dict[int, float],
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
) -> list[float]:
    # Legacy costing rows hold ONE discount per product (see
    # models/sales_order_costing.py), but #sales_summary is per line and a
    # product can legitimately appear on two lines of the same order. Split
    # that single discount across its lines in proportion to each line's own
    # value so the per-line tax stays sensible; a product whose lines are all
    # worth zero splits it evenly instead of dividing by zero. Rows keyed per
    # line never come through here — see _line_discounts_from_costings.
    if not discount_by_product:
        return [0.0] * len(product_ids)

    line_values = [quantity * rate for quantity, rate in zip(quantities, rates)]
    value_by_product: dict[int, float] = {}
    lines_by_product: dict[int, int] = {}
    for product_id, line_value in zip(product_ids, line_values):
        value_by_product[product_id] = value_by_product.get(product_id, 0.0) + line_value
        lines_by_product[product_id] = lines_by_product.get(product_id, 0) + 1

    discounts = []
    for product_id, line_value in zip(product_ids, line_values):
        discount = discount_by_product.get(product_id, 0.0)
        if not discount:
            discounts.append(0.0)
        elif value_by_product[product_id]:
            discounts.append(discount * (line_value / value_by_product[product_id]))
        else:
            discounts.append(discount / lines_by_product[product_id])
    return discounts


def _allocate_overall_discount(overall_discount: float, net_line_values: list[float]) -> list[float]:
    # The order-level discount (SalesOrders.overall_discount) is ONE figure
    # against the whole order, but tax is charged per line, so it has to be
    # split before it can be charged. Split in proportion to each line's
    # value AFTER that line's share of its product's costing discount, so a
    # line already discounted on the sheet isn't discounted twice as hard
    # here; an order whose lines are all worth zero splits it evenly rather
    # than dividing by zero.
    if not overall_discount or not net_line_values:
        return [0.0] * len(net_line_values)

    total_value = sum(net_line_values)
    if not total_value:
        return [overall_discount / len(net_line_values)] * len(net_line_values)
    return [overall_discount * (line_value / total_value) for line_value in net_line_values]


def _reject_overall_discount_above_subtotal(
    overall_discount: float,
    quantities: list[int],
    rates: list[float],
    discounts: list[float] | None,
) -> None:
    # A discount bigger than what's left of the order after the costing
    # sheet's own discounts would push the totals — and the tax — negative.
    # Checked against the same net subtotal the discount is applied to, so
    # discounting an order down to exactly zero is still allowed.
    if not overall_discount:
        return

    line_discounts = discounts if discounts is not None else [0.0] * len(quantities)
    net_subtotal = sum(
        quantity * rate - discount for quantity, rate, discount in zip(quantities, rates, line_discounts)
    )
    if overall_discount > net_subtotal:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"discount ({overall_discount:.2f}) is larger than the order's net amount "
                f"({net_subtotal:.2f})"
            ),
        )


def _line_discounts_from_costings(
    costings: list[SalesOrderCosting],
    line_item_ids: list[int | None],
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
) -> list[float]:
    # Each line takes the discount of the costing row keyed on it (a line
    # with no id yet — just added on the form — has none). A legacy row keyed
    # by product only (see models/sales_order_costing.py) covers every line
    # of that product that has no row of its own, split between them pro
    # rata exactly as it always was.
    discount_by_line = {
        costing.sales_summary_id: costing.discount
        for costing in costings
        if costing.sales_summary_id is not None
    }
    legacy_by_product = {
        costing.product_id: costing.discount
        for costing in costings
        if costing.sales_summary_id is None and costing.discount
    }

    discounts = [
        discount_by_line.get(line_item_id, 0.0) if line_item_id is not None else 0.0
        for line_item_id in line_item_ids
    ]
    legacy_indexes = [
        index
        for index, line_item_id in enumerate(line_item_ids)
        if line_item_id is None or line_item_id not in discount_by_line
    ]
    legacy_discounts = _allocate_line_discounts(
        legacy_by_product,
        [product_ids[index] for index in legacy_indexes],
        [quantities[index] for index in legacy_indexes],
        [rates[index] for index in legacy_indexes],
    )
    for index, discount in zip(legacy_indexes, legacy_discounts):
        discounts[index] = discount
    return discounts


async def _stored_line_discounts(
    sales_order_id: int,
    line_item_ids: list[int | None],
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
) -> list[float]:
    # Legacy rows for products no longer on the order are simply not looked
    # up rather than deleted — removing a product from an order and adding
    # it back shouldn't silently lose the costing that was entered for it.
    # (Per-line rows DO go with their line — see _write_sales_summary_rows.)
    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == sales_order_id).to_list()
    return _line_discounts_from_costings(costings, line_item_ids, product_ids, quantities, rates)


def delivery_tax_amount(delivery_charge: float, delivery_tax_perc: float) -> float:
    """GST on a delivery charge, computed exactly like a line item's.

    One definition, because three places have to agree on it to the paisa:
    the order totals stored here, the delivery line the invoice PDF prints,
    and the same line the client portal shows (both in routes/invoices.py).
    Deliberately unrounded, like the per-line tax above it — rounding is a
    presentation step.
    """
    return delivery_charge * (delivery_tax_perc / 100)


def _compute_line_items_and_totals(
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    discounts: list[float] | None = None,
    overall_discount: float = 0.0,
    delivery_charge: float = 0.0,
    delivery_tax_perc: float = 0.0,
) -> tuple[list[float], list[float], float, float, float]:
    # `discounts` is each line's share of its product's costing discount (see
    # _allocate_line_discounts). None on create — a brand-new order has no
    # costing rows yet — and all-zero for any order whose "Add details" sheet
    # has never been filled in, so both cases reduce to the plain
    # quantity x rate this used to compute.
    #
    # NOTE the resulting total_before_tax is therefore NET OF DISCOUNT, and
    # tax is charged on the discounted subtotal, matching the costing sheet's
    # Net Subtotal -> Sales tax amount -> Gross Sales Price chain exactly
    # (see frontend/src/lib/sales-order-costing.ts). The order row and the
    # sheet can never disagree.
    #
    # `overall_discount` is the order's own discount off its whole net amount
    # (SalesOrders.overall_discount), applied ON TOP of those per-product
    # discounts and split across the lines the same pro-rata way, so it lands
    # in the subtotals before tax is charged rather than being subtracted
    # from a finished total.
    if discounts is None:
        discounts = [0.0] * len(quantities)
    line_subtotals = [
        quantity * rate - discount for quantity, rate, discount in zip(quantities, rates, discounts)
    ]
    line_subtotals = [
        subtotal - share
        for subtotal, share in zip(
            line_subtotals, _allocate_overall_discount(overall_discount, line_subtotals)
        )
    ]
    tax_amounts = [subtotal * (tax_perc / 100) for subtotal, tax_perc in zip(line_subtotals, tax_percs)]
    # `delivery_charge` is billed on top of the products rather than spread
    # across them (see SalesOrders.delivery_charge), so it lands in the
    # TOTALS only — the two per-line lists returned below stay products-only,
    # since they become this order's #sales_summary rows and delivery is not
    # a product. The invoice prints it as its own line instead, built from
    # the order in routes/invoices.py.
    #
    # No discount interacts with it either: overall_discount is a discount on
    # the goods, and _reject_overall_discount_above_subtotal checks it
    # against the goods' subtotal for exactly that reason.
    total_before_tax = sum(line_subtotals) + delivery_charge
    total_tax = sum(tax_amounts) + delivery_tax_amount(delivery_charge, delivery_tax_perc)
    total_after_tax = total_before_tax + total_tax
    return line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax


def _line_notes(notes: list[str] | None, line_count: int) -> list[str]:
    # The optional per-line notes as one entry per line: a client that left
    # the list out gets no note on any line, and whitespace-only entries are
    # stored as "" so "no note" is spelled one way. See SalesSummary.note.
    if notes is None:
        return [""] * line_count
    return [note.strip() for note in notes]


async def _insert_sales_summary_rows(
    sales_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    notes: list[str],
    tax_amounts: list[float],
    line_subtotals: list[float],
) -> None:
    for product_id, quantity, rate, tax_perc, note, tax_amount, line_subtotal in zip(
        product_ids, quantities, rates, tax_percs, notes, tax_amounts, line_subtotals
    ):
        summary_id = await get_next_id(SalesSummaryIdCounter, "next_sales_summary_id", SalesSummary)
        await SalesSummary(
            id=summary_id,
            sales_order_id=sales_order_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
            tax_perc=tax_perc,
            tax_amount=tax_amount,
            total=line_subtotal + tax_amount,
            note=note,
        ).insert()


async def _sorted_line_items(sales_order_id: int) -> list[SalesSummary]:
    # Always by id: rows are inserted in form order and keep their ids
    # across edits, so id order IS the order the form shows them in.
    line_items = await SalesSummary.find(SalesSummary.sales_order_id == sales_order_id).to_list()
    return sorted(line_items, key=lambda line_item: line_item.id)


def _resolve_line_item_ids(
    existing: list[SalesSummary], payload: UpdateSalesOrderDetailsRequest
) -> list[int | None]:
    # Which existing #sales_summary row each submitted line is, so the edit
    # can update it in place and keep its id (the "Add details" costing is
    # keyed on it — see models/sales_order_costing.py). None means a fresh
    # row.
    #
    # A line whose product was switched counts as a fresh row too: its
    # costing was seeded from and entered for the OLD product, so carrying
    # the row over would keep a purchase rate for something no longer on the
    # line. The old row (and its costing) is dropped with the other
    # unmatched ones.
    existing_by_id = {row.id: row for row in existing}

    if payload.line_item_ids is None:
        # No ids sent (older client): match by position, which is form
        # order, as long as the product still lines up.
        return [
            existing[index].id
            if index < len(existing) and existing[index].product_id == product_id
            else None
            for index, product_id in enumerate(payload.product_ids)
        ]

    resolved: list[int | None] = []
    for line_item_id, product_id in zip(payload.line_item_ids, payload.product_ids):
        if line_item_id is None:
            resolved.append(None)
            continue
        row = existing_by_id.get(line_item_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"line item {line_item_id} is not on this sales order — "
                    "the order may have changed in another tab; reload and try again"
                ),
            )
        resolved.append(row.id if row.product_id == product_id else None)
    return resolved


async def _write_sales_summary_rows(
    sales_order_id: int,
    existing: list[SalesSummary],
    line_item_ids: list[int | None],
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    notes: list[str],
    tax_amounts: list[float],
    line_subtotals: list[float],
) -> None:
    # The edit-time counterpart of _insert_sales_summary_rows: existing rows
    # are updated in place so their ids survive, new lines are inserted, and
    # rows the form no longer lists are deleted along with the costing that
    # hung off them — a per-line costing row has nothing to describe once
    # its line is gone.
    existing_by_id = {row.id: row for row in existing}
    kept_ids: set[int] = set()
    for line_item_id, product_id, quantity, rate, tax_perc, note, tax_amount, line_subtotal in zip(
        line_item_ids, product_ids, quantities, rates, tax_percs, notes, tax_amounts, line_subtotals
    ):
        if line_item_id is None:
            summary_id = await get_next_id(SalesSummaryIdCounter, "next_sales_summary_id", SalesSummary)
            await SalesSummary(
                id=summary_id,
                sales_order_id=sales_order_id,
                product_id=product_id,
                quantity=quantity,
                rate=rate,
                tax_perc=tax_perc,
                tax_amount=tax_amount,
                total=line_subtotal + tax_amount,
                note=note,
            ).insert()
            continue
        row = existing_by_id[line_item_id]
        row.product_id = product_id
        row.quantity = quantity
        row.rate = rate
        row.tax_perc = tax_perc
        row.tax_amount = tax_amount
        row.total = line_subtotal + tax_amount
        row.note = note
        await row.save()
        kept_ids.add(line_item_id)

    removed_ids = [row.id for row in existing if row.id not in kept_ids]
    if removed_ids:
        await SalesSummary.find(In(SalesSummary.id, removed_ids)).delete()
        await SalesOrderCosting.find(
            SalesOrderCosting.sales_order_id == sales_order_id,
            In(SalesOrderCosting.sales_summary_id, removed_ids),
        ).delete()


@router.post("/create_new_sales_order", response_model=CreateNewSalesOrderResponse)
async def create_new_sales_order(
    payload: CreateNewSalesOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewSalesOrderResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids, reject_deleted=True)
    await _validate_purchase_orders_exist(payload.related_purchase_order_ids)
    await _validate_unbilled_purchase_orders_exist(payload.related_unbilled_purchase_order_ids)

    # No discounts term: a sales order can only be costed once it exists,
    # so a brand-new one never has #sales_order_costing rows. The order's own
    # overall discount does come off the form, though.
    _reject_overall_discount_above_subtotal(
        payload.overall_discount, payload.quantities, payload.rates, None
    )
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(
            payload.quantities,
            payload.rates,
            payload.tax_percs,
            overall_discount=payload.overall_discount,
            delivery_charge=payload.delivery_charge,
            delivery_tax_perc=payload.delivery_tax_perc,
        )
    )

    order_status_id = await _get_new_status_id()
    order_no = await get_next_id(OrderNoCounterMaster, "next_order_no", SalesOrders)
    sales_order_id = await get_next_id(SalesOrderIdCounter, "next_sales_order_id", SalesOrders)

    sales_order = SalesOrders(
        id=sales_order_id,
        order_no=order_no,
        order_status_id=order_status_id,
        cust_id=payload.cust_id,
        date=payload.date,
        overall_discount=payload.overall_discount,
        delivery_charge=payload.delivery_charge,
        delivery_tax_perc=payload.delivery_tax_perc,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        description=payload.description,
        related_purchase_order_ids=payload.related_purchase_order_ids,
        related_unbilled_purchase_order_ids=payload.related_unbilled_purchase_order_ids,
    )
    await sales_order.insert()

    await _insert_sales_summary_rows(
        sales_order_id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        _line_notes(payload.notes, len(payload.product_ids)),
        tax_amounts,
        line_subtotals,
    )
    # No inventory movement here — a new order is always created as "New",
    # and stock is only taken out once it is moved to "Delivered" via
    # update_sales_order_details.

    return CreateNewSalesOrderResponse(message="sales order successfully created")


@router.get("/get_sales_order_details", response_model=list[SalesOrderDetailItem])
async def get_sales_order_details(
    _: User | None = Depends(require_admin),
) -> list[SalesOrderDetailItem]:
    # Soft-deleted orders are excluded here so they can never be viewed —
    # unlike get_vendor_details/get_customer_details, there is no
    # Active/Deleted tab for sales orders to split them into.
    orders = await SalesOrders.find(SalesOrders.is_deleted == False).to_list()
    if not orders:
        return []

    order_ids = [order.id for order in orders]
    summaries = await SalesSummary.find(In(SalesSummary.sales_order_id, order_ids)).to_list()
    summaries_by_order_id: dict[int, list[SalesSummary]] = {}
    for summary in summaries:
        summaries_by_order_id.setdefault(summary.sales_order_id, []).append(summary)

    response = []
    for order in orders:
        # By id, so the form's line order matches the costing sheet's (see
        # _sorted_line_items).
        line_items = sorted(summaries_by_order_id.get(order.id, []), key=lambda line_item: line_item.id)
        response.append(
            SalesOrderDetailItem(
                id=order.id,
                order_no=order.order_no,
                order_status_id=order.order_status_id,
                cust_id=order.cust_id,
                date=order.date,
                line_item_ids=[item.id for item in line_items],
                product_ids=[item.product_id for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                tax_percs=[item.tax_perc for item in line_items],
                notes=[item.note for item in line_items],
                overall_discount=order.overall_discount,
                delivery_charge=order.delivery_charge,
                delivery_tax_perc=order.delivery_tax_perc,
                total_amount_before_tax=order.total_amount_before_tax,
                total_tax_amount=order.total_tax_amount,
                total_amount_after_tax=order.total_amount_after_tax,
                description=order.description,
                related_purchase_order_ids=order.related_purchase_order_ids,
                related_unbilled_purchase_order_ids=order.related_unbilled_purchase_order_ids,
                po_updated_flag=order.po_updated_flag,
                is_deleted=order.is_deleted,
            )
        )

    return response


@router.post("/update_sales_order_details", response_model=UpdateSalesOrderDetailsResponse)
async def update_sales_order_details(
    payload: UpdateSalesOrderDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateSalesOrderDetailsResponse:
    sales_order = await SalesOrders.get(payload.id)
    if sales_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sales order not found")

    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)
    await _validate_purchase_orders_exist(payload.related_purchase_order_ids)
    await _validate_unbilled_purchase_orders_exist(payload.related_unbilled_purchase_order_ids)
    await _validate_order_status_exists(payload.order_status_id)

    # Which existing rows the submitted lines are (see _resolve_line_item_ids)
    # — settled first because the discounts below are keyed on them.
    existing_line_items = await _sorted_line_items(sales_order.id)
    line_item_ids = _resolve_line_item_ids(existing_line_items, payload)

    # Carries any discount already entered on this order's "Add details"
    # sheet through the edit — #sales_summary has no discount column, so
    # re-saving the order form would otherwise quietly undo it.
    discounts = await _stored_line_discounts(
        sales_order.id, line_item_ids, payload.product_ids, payload.quantities, payload.rates
    )
    _reject_overall_discount_above_subtotal(
        payload.overall_discount, payload.quantities, payload.rates, discounts
    )
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(
            payload.quantities,
            payload.rates,
            payload.tax_percs,
            discounts,
            payload.overall_discount,
            payload.delivery_charge,
            payload.delivery_tax_perc,
        )
    )

    # A soft-deleted order holds no stock even if it was delivered, so
    # deleting one credits its quantities back exactly like moving it out of
    # "Delivered" does.
    holds_stock = payload.order_status_id in await _get_stock_deducted_status_ids() and not payload.is_deleted
    stock_deltas: dict[int, int] = {}
    if holds_stock:
        # Delta against what this order already has out of #inventory: the
        # full order on the move into "Delivered", and only the difference
        # when an already-delivered order's line items are edited.
        stock_deltas = compute_stock_deltas(
            await get_applied_sales_quantities(sales_order.id),
            totals_by_product(payload.product_ids, payload.quantities),
            STOCK_OUT,
        )
        await _reject_stock_going_negative(stock_deltas)

    sales_order.order_status_id = payload.order_status_id
    sales_order.cust_id = payload.cust_id
    sales_order.date = payload.date
    sales_order.overall_discount = payload.overall_discount
    sales_order.delivery_charge = payload.delivery_charge
    sales_order.delivery_tax_perc = payload.delivery_tax_perc
    sales_order.total_amount_before_tax = total_before_tax
    sales_order.total_tax_amount = total_tax
    sales_order.total_amount_after_tax = total_after_tax
    sales_order.description = payload.description
    sales_order.related_purchase_order_ids = payload.related_purchase_order_ids
    sales_order.related_unbilled_purchase_order_ids = payload.related_unbilled_purchase_order_ids
    sales_order.is_deleted = payload.is_deleted
    # Saving the sales order counts as the admin having reviewed whatever
    # related-PO change set the flag (see SalesOrders.po_updated_flag).
    sales_order.po_updated_flag = False
    await sales_order.save()

    await _write_sales_summary_rows(
        sales_order.id,
        existing_line_items,
        line_item_ids,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        _line_notes(payload.notes, len(payload.product_ids)),
        tax_amounts,
        line_subtotals,
    )

    if holds_stock:
        await apply_sales_order_stock(
            sales_order.id, payload.product_ids, payload.quantities, stock_deltas, payload.date
        )
    else:
        await clear_sales_order_stock(sales_order.id)

    # Any invoice already raised against this order snapshotted the totals
    # that just changed, while its PDF prints the #sales_summary rows this
    # very endpoint updated a few lines up. Left alone, the two disagree and
    # the invoice stops adding up — see services/invoice_totals.py.
    await refresh_invoice_totals_for_sales_orders([sales_order.id])

    return UpdateSalesOrderDetailsResponse(message="sales order updated successfully")


@router.post("/update_sales_order_status", response_model=UpdateSalesOrderStatusResponse)
async def update_sales_order_status(
    payload: UpdateSalesOrderStatusRequest,
    _: User | None = Depends(require_admin),
) -> UpdateSalesOrderStatusResponse:
    """Move one sales order between statuses, and nothing else.

    Backs the status dropdown in each row of the admin sales orders table.
    update_sales_order_details can do this too, but only as part of re-saving
    the whole order: it rewrites #sales_summary from the payload, recomputes
    the totals, and clears po_updated_flag. Flipping a status from a table
    row should touch none of that, hence the narrow endpoint.

    The stock side, though, is the same work update_sales_order_details does,
    for the same reason: crossing into "Delivered"/"Completed" is what takes
    the order's quantities out of #inventory, and moving back out of them is
    what credits them back (see _STOCK_DEDUCTED_STATUS_NAMES). So a status
    change can legitimately fail — marking an order delivered that there
    isn't stock for is rejected here exactly as it is on the order form.
    """
    sales_order = await SalesOrders.get(payload.id)
    if sales_order is None or sales_order.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sales order not found")

    await _validate_order_status_exists(payload.order_status_id)

    if sales_order.order_status_id == payload.order_status_id:
        return UpdateSalesOrderStatusResponse(message="sales order status unchanged")

    # The order's line items live in #sales_summary rather than on the order
    # document, and this endpoint takes no line items of its own — the
    # quantities that move are whatever the order currently holds.
    line_items = await SalesSummary.find(SalesSummary.sales_order_id == sales_order.id).to_list()
    product_ids = [item.product_id for item in line_items]
    quantities = [item.quantity for item in line_items]

    holds_stock = payload.order_status_id in await _get_stock_deducted_status_ids()
    stock_deltas: dict[int, int] = {}
    if holds_stock:
        stock_deltas = compute_stock_deltas(
            await get_applied_sales_quantities(sales_order.id),
            totals_by_product(product_ids, quantities),
            STOCK_OUT,
        )
        # Before the save, so a rejected move leaves the order on its old
        # status instead of half-applied.
        await _reject_stock_going_negative(stock_deltas)

    sales_order.order_status_id = payload.order_status_id
    await sales_order.save()

    if holds_stock:
        await apply_sales_order_stock(
            sales_order.id, product_ids, quantities, stock_deltas, sales_order.date
        )
    else:
        await clear_sales_order_stock(sales_order.id)

    return UpdateSalesOrderStatusResponse(message="sales order status updated successfully")


@router.get("/get_order_status_list", response_model=list[OrderStatusListItem])
async def get_order_status_list(
    _: User | None = Depends(require_admin),
) -> list[OrderStatusListItem]:
    statuses = await OrderStatusMaster.find_all().to_list()
    return [OrderStatusListItem(id=status_row.id, status_name=status_row.status_name) for status_row in statuses]


# ---------------------------------------------------------------------------
# Sales order costing — the "Add details" sheet
# ---------------------------------------------------------------------------
# One row per #sales_summary line, keyed by its id (see
# models/sales_order_costing.py) — the same product on two lines at two
# rates is two rows, costed separately. Everything the sheet displays beyond
# these inputs is derived client-side, as the admin types -
# frontend/src/lib/sales-order-costing.ts holds those formulas.


def _costings_by_line_and_legacy(
    costings: list[SalesOrderCosting],
) -> tuple[dict[int, SalesOrderCosting], dict[int, SalesOrderCosting]]:
    # Split an order's costing rows into those keyed on a line and the
    # legacy product-keyed ones (sales_summary_id None). A legacy row stands
    # in for every line of its product that has no row of its own.
    by_line = {
        costing.sales_summary_id: costing for costing in costings if costing.sales_summary_id is not None
    }
    legacy_by_product = {
        costing.product_id: costing for costing in costings if costing.sales_summary_id is None
    }
    return by_line, legacy_by_product


async def _get_active_sales_order(sales_order_id: int) -> SalesOrders:
    sales_order = await SalesOrders.get(sales_order_id)
    if sales_order is None or sales_order.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sales order not found")
    return sales_order


@router.get("/get_sales_order_costing", response_model=SalesOrderCostingResponse)
async def get_sales_order_costing(
    sales_order_id: int,
    _: User | None = Depends(require_admin),
) -> SalesOrderCostingResponse:
    sales_order = await _get_active_sales_order(sales_order_id)

    line_items = await _sorted_line_items(sales_order_id)
    product_ids = list({item.product_id for item in line_items})

    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == sales_order_id).to_list()
    costings_by_line, legacy_by_product = _costings_by_line_and_legacy(costings)

    customer = await CustomerDetails.get(sales_order.cust_id)
    order_status = await OrderStatusMaster.get(sales_order.order_status_id)

    lines = []
    for item in line_items:
        product = products_by_id.get(item.product_id)
        # A row saved before costing was per line shows as this line's
        # figures too, until the sheet is next saved (which then splits it).
        costing = costings_by_line.get(item.id) or legacy_by_product.get(item.product_id)
        lines.append(
            SalesOrderCostingLine(
                line_item_id=item.id,
                product_id=item.product_id,
                # A since-deleted product still has to render, hence the
                # placeholder rather than a 404 on the whole sheet.
                model_name=product.product_name if product else f"Product {item.product_id}",
                quantity=item.quantity,
                # First open: seed the cost side from the product master
                # (vendor_rate for the purchase rate, gst_perc as the most
                # likely purchase tax). Once saved, the stored figures win —
                # a later edit to the product must not rewrite a costed order.
                net_purchase_rate=(
                    costing.net_purchase_rate if costing else (product.vendor_rate if product else 0.0)
                ),
                purchase_tax_perc=(
                    costing.purchase_tax_perc if costing else (product.gst_perc if product else 0.0)
                ),
                printing_costs=(
                    [
                        PrintingCostItem(
                            printing_type=printing.printing_type,
                            cost_per_unit=printing.cost_per_unit,
                            is_taxable=printing.is_taxable,
                            tax_perc=printing.tax_perc,
                        )
                        for printing in costing.printing_costs
                    ]
                    if costing
                    else []
                ),
                delivery=costing.delivery if costing else 0.0,
                miscellaneous=costing.miscellaneous if costing else 0.0,
                # Sales side comes off the live line item, not the product
                # master — the order form already defaulted it from
                # discounted_price when the order was raised.
                net_sales_rate=item.rate,
                discount=costing.discount if costing else 0.0,
                sales_tax_perc=item.tax_perc,
                is_saved=costing is not None,
            )
        )

    return SalesOrderCostingResponse(
        sales_order_id=sales_order.id,
        order_no=sales_order.order_no,
        # CustomerDetails has no plain "name" — registered_name is what
        # get_customer_list surfaces as the customer name everywhere else.
        customer_name=customer.registered_name if customer else "—",
        date=sales_order.date,
        order_status_name=order_status.status_name if order_status else "—",
        # Entered on the order form, shown read-only in this sheet's footer
        # so its totals reconcile with the order's.
        overall_discount=sales_order.overall_discount,
        delivery_charge=sales_order.delivery_charge,
        delivery_tax_perc=sales_order.delivery_tax_perc,
        lines=lines,
    )


@router.post("/update_sales_order_costing", response_model=UpdateSalesOrderCostingResponse)
async def update_sales_order_costing(
    payload: UpdateSalesOrderCostingRequest,
    _: User | None = Depends(require_admin),
) -> UpdateSalesOrderCostingResponse:
    sales_order = await _get_active_sales_order(payload.sales_order_id)

    sorted_items = await _sorted_line_items(payload.sales_order_id)
    if not sorted_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sales order has no line items")

    # All-or-nothing: the sheet always submits every line, so a mismatch
    # means the order's line items changed in another tab since it loaded,
    # and saving a partial set would leave the order's totals wrong.
    order_line_ids = {item.id for item in sorted_items}
    payload_line_ids = {line.line_item_id for line in payload.lines}
    if payload_line_ids != order_line_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "costing must cover exactly the order's line items "
                f"(expected {sorted(order_line_ids)}, got {sorted(payload_line_ids)}) — "
                "the order's line items may have changed; reload and try again"
            ),
        )

    lines_by_id = {line.line_item_id: line for line in payload.lines}

    # --- sales side: written straight back onto the live line items --------
    # Net Sales Rate and Sales Tax % ARE SalesSummary.rate/tax_perc, so the
    # order row's own totals move with the sheet.
    for item in sorted_items:
        line = lines_by_id[item.id]
        item.rate = line.net_sales_rate
        item.tax_perc = line.sales_tax_perc

    # --- cost side: upserted into #sales_order_costing ---------------------
    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == payload.sales_order_id).to_list()
    costings_by_line, legacy_by_product = _costings_by_line_and_legacy(costings)

    for item in sorted_items:
        line = lines_by_id[item.id]
        printing_costs = [
            PrintingCost(
                printing_type=printing.printing_type,
                cost_per_unit=printing.cost_per_unit,
                is_taxable=printing.is_taxable,
                # A printing type the admin untaxed keeps no stale rate.
                tax_perc=printing.tax_perc if printing.is_taxable else 0.0,
            )
            for printing in line.printing_costs
        ]
        costing = costings_by_line.get(item.id)
        if costing is None:
            # A legacy product-keyed row (see models/sales_order_costing.py)
            # is claimed by the first of its product's lines to save; the
            # rest get rows of their own below. pop() so it is claimed once.
            costing = legacy_by_product.pop(item.product_id, None)
            if costing is not None:
                costing.sales_summary_id = item.id
        if costing is None:
            costing_id = await get_next_id(
                SalesOrderCostingIdCounter, "next_sales_order_costing_id", SalesOrderCosting
            )
            costing = SalesOrderCosting(
                id=costing_id,
                sales_order_id=payload.sales_order_id,
                sales_summary_id=item.id,
                product_id=item.product_id,
                net_purchase_rate=line.net_purchase_rate,
                purchase_tax_perc=line.purchase_tax_perc,
                printing_costs=printing_costs,
                delivery=line.delivery,
                miscellaneous=line.miscellaneous,
                discount=line.discount,
            )
            await costing.insert()
        else:
            costing.net_purchase_rate = line.net_purchase_rate
            costing.purchase_tax_perc = line.purchase_tax_perc
            costing.printing_costs = printing_costs
            costing.delivery = line.delivery
            costing.miscellaneous = line.miscellaneous
            costing.discount = line.discount
            await costing.save()

    # --- re-derive the line items' tax/total and the order's headline totals
    quantities = [item.quantity for item in sorted_items]
    rates = [item.rate for item in sorted_items]
    tax_percs = [item.tax_perc for item in sorted_items]
    # Discount is per line now, so no pro-rata split to do.
    discounts = [lines_by_id[item.id].discount for item in sorted_items]
    # The order's overall discount isn't editable here, but it still has to
    # be carried into the recompute — leaving it out would silently drop it
    # from the order's totals the first time this sheet is saved.
    _reject_overall_discount_above_subtotal(sales_order.overall_discount, quantities, rates, discounts)
    # The delivery charge isn't editable on this sheet (it belongs to the
    # order form), but re-deriving the order's totals without it would drop
    # it from the order the moment anyone saved the costing.
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = _compute_line_items_and_totals(
        quantities,
        rates,
        tax_percs,
        discounts,
        sales_order.overall_discount,
        sales_order.delivery_charge,
        sales_order.delivery_tax_perc,
    )

    for item, line_subtotal, tax_amount in zip(sorted_items, line_subtotals, tax_amounts):
        item.tax_amount = tax_amount
        item.total = line_subtotal + tax_amount
        await item.save()

    sales_order.total_amount_before_tax = total_before_tax
    sales_order.total_tax_amount = total_tax
    sales_order.total_amount_after_tax = total_after_tax
    await sales_order.save()

    # This sheet moves the order's totals too — editing a rate, a per-product
    # discount or the sales tax % all land here — so any invoice raised
    # against the order needs re-snapshotting for the same reason as in
    # update_sales_order_details above.
    await refresh_invoice_totals_for_sales_orders([sales_order.id])

    # Quantities are read-only on this sheet, so nothing here can move stock
    # — no #inventory work to do, unlike update_sales_order_details.
    return UpdateSalesOrderCostingResponse(message="sales order details saved successfully")


# ---------------------------------------------------------------------------
# Costing report — the "Costing" view on the Sales orders tab
# ---------------------------------------------------------------------------
# Every active order's cost side, one row per product per order (see
# SalesOrderCostingReportRow). Only the cost inputs are read here; the sales
# side stays on the orders table and the "Add details" sheet.


class _CostAccumulator:
    # Running cost-side sums for one (order, product) row.
    def __init__(self) -> None:
        self.quantity = 0
        self.purchase_cost = 0.0
        self.purchase_tax = 0.0
        # Lowercased type -> [display name, cost, tax]; the first spelling
        # seen is the one shown.
        self.printing: dict[str, list] = {}
        self.delivery = 0.0
        self.miscellaneous = 0.0
        self.is_costed = True

    def add(
        self,
        quantity: int,
        net_purchase_rate: float,
        purchase_tax_perc: float,
        printing_costs: list[PrintingCost],
        delivery: float,
        miscellaneous: float,
    ) -> None:
        # Same conventions as computeCostingFigures in
        # frontend/src/lib/sales-order-costing.ts: purchase and printing are
        # per piece, delivery and miscellaneous are flat per costing row.
        purchase_cost = quantity * net_purchase_rate
        self.purchase_cost += purchase_cost
        self.purchase_tax += purchase_cost * purchase_tax_perc / 100
        for printing in printing_costs:
            name = printing.printing_type.strip()
            entry = self.printing.setdefault(name.lower(), [name, 0.0, 0.0])
            cost = quantity * printing.cost_per_unit
            entry[1] += cost
            if printing.is_taxable:
                entry[2] += cost * printing.tax_perc / 100
        self.delivery += delivery
        self.miscellaneous += miscellaneous


def _build_costing_report_rows(
    orders: list[SalesOrders],
    summaries: list[SalesSummary],
    costings: list[SalesOrderCosting],
    products_by_id: dict[int, ProductDetails],
) -> list[SalesOrderCostingReportRow]:
    """One report row per (order, product), summing every line of that product.

    A line costed on its own contributes its own row's figures. Lines with no
    row of their own but a legacy product-keyed row (see
    models/sales_order_costing.py) are costed by that row ONCE, over their
    summed quantity — so its flat delivery/misc counts once, the same way the
    accounts P&L (_cost_by_sales_order) counts it. Lines with neither fall
    back to the product master's defaults, as the sheet does on first open,
    and mark the row not costed.
    """
    summaries_by_order: dict[int, list[SalesSummary]] = {}
    for summary in summaries:
        summaries_by_order.setdefault(summary.sales_order_id, []).append(summary)
    costings_by_order: dict[int, list[SalesOrderCosting]] = {}
    for costing in costings:
        costings_by_order.setdefault(costing.sales_order_id, []).append(costing)

    rows: list[SalesOrderCostingReportRow] = []
    for order in sorted(orders, key=lambda order: order.id):
        by_line, legacy_by_product = _costings_by_line_and_legacy(costings_by_order.get(order.id, []))

        # Dicts keep insertion order, so products appear in line order.
        accumulators: dict[int, _CostAccumulator] = {}
        legacy_quantity: dict[int, int] = {}
        for item in sorted(summaries_by_order.get(order.id, []), key=lambda line_item: line_item.id):
            accumulator = accumulators.setdefault(item.product_id, _CostAccumulator())
            accumulator.quantity += item.quantity
            costing = by_line.get(item.id)
            if costing is not None:
                accumulator.add(
                    item.quantity,
                    costing.net_purchase_rate,
                    costing.purchase_tax_perc,
                    costing.printing_costs,
                    costing.delivery,
                    costing.miscellaneous,
                )
            elif item.product_id in legacy_by_product:
                legacy_quantity[item.product_id] = legacy_quantity.get(item.product_id, 0) + item.quantity
            else:
                product = products_by_id.get(item.product_id)
                accumulator.add(
                    item.quantity,
                    product.vendor_rate if product else 0.0,
                    product.gst_perc if product else 0.0,
                    [],
                    0.0,
                    0.0,
                )
                accumulator.is_costed = False

        for product_id, quantity in legacy_quantity.items():
            legacy = legacy_by_product[product_id]
            accumulators[product_id].add(
                quantity,
                legacy.net_purchase_rate,
                legacy.purchase_tax_perc,
                legacy.printing_costs,
                legacy.delivery,
                legacy.miscellaneous,
            )

        for product_id, accumulator in accumulators.items():
            product = products_by_id.get(product_id)
            printing_costs = [
                CostingReportPrinting(printing_type=name, cost=cost, tax=tax)
                for name, cost, tax in accumulator.printing.values()
            ]
            rows.append(
                SalesOrderCostingReportRow(
                    sales_order_id=order.id,
                    order_no=order.order_no,
                    order_status_id=order.order_status_id,
                    cust_id=order.cust_id,
                    date=order.date,
                    product_id=product_id,
                    product_name=product.product_name if product else f"Product {product_id}",
                    quantity=accumulator.quantity,
                    purchase_cost=accumulator.purchase_cost,
                    purchase_tax=accumulator.purchase_tax,
                    printing_costs=printing_costs,
                    delivery=accumulator.delivery,
                    miscellaneous=accumulator.miscellaneous,
                    # Taxes excluded — reclaimable input credit, not cost.
                    total_cost=(
                        accumulator.purchase_cost
                        + sum(printing.cost for printing in printing_costs)
                        + accumulator.delivery
                        + accumulator.miscellaneous
                    ),
                    is_costed=accumulator.is_costed,
                )
            )

    return rows


@router.get("/get_sales_order_costing_report", response_model=list[SalesOrderCostingReportRow])
async def get_sales_order_costing_report(
    _: User | None = Depends(require_admin),
) -> list[SalesOrderCostingReportRow]:
    # Soft-deleted orders are left out, as on get_sales_order_details.
    orders = await SalesOrders.find(SalesOrders.is_deleted == False).to_list()
    if not orders:
        return []

    order_ids = [order.id for order in orders]
    summaries = await SalesSummary.find(In(SalesSummary.sales_order_id, order_ids)).to_list()
    costings = await SalesOrderCosting.find(In(SalesOrderCosting.sales_order_id, order_ids)).to_list()
    product_ids = list({summary.product_id for summary in summaries})
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()

    return _build_costing_report_rows(orders, summaries, costings, {product.id: product for product in products})
