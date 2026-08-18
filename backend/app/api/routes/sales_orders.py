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
    User,
)
from app.schemas.sales_order_costing import (
    PrintingCostItem,
    SalesOrderCostingLine,
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
)
from app.services.counters import get_next_id
from app.services.inventory import (
    STOCK_OUT,
    apply_sales_order_stock,
    clear_sales_order_stock,
    compute_stock_deltas,
    find_stock_shortfalls,
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


async def _validate_products_exist(product_ids: list[int]) -> None:
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    found_ids = {product.id for product in products}
    for product_id in product_ids:
        if product_id not in found_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")


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


async def _reject_stock_going_negative(stock_deltas: dict[int, int]) -> None:
    # Reached when an order is being marked delivered, or when a delivered
    # order's line items are edited upwards — either way the extra stock has
    # to actually exist. The delta is what this change takes out on top of
    # whatever the order already holds, so re-saving a delivered order
    # unchanged can never trip this.
    shortfalls = await find_stock_shortfalls(stock_deltas)
    if not shortfalls:
        return

    details = ", ".join(
        f"product {product_id} (on hand {on_hand}, needs {-delta} more)"
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
    # The costing sheet holds ONE discount per product (see
    # models/sales_order_costing.py), but #sales_summary is per line and a
    # product can legitimately appear on two lines of the same order. Split
    # that single discount across its lines in proportion to each line's own
    # value so the per-line tax stays sensible; a product whose lines are all
    # worth zero splits it evenly instead of dividing by zero.
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


async def _stored_line_discounts(
    sales_order_id: int, product_ids: list[int], quantities: list[int], rates: list[float]
) -> list[float]:
    # Rows for products no longer on the order are simply not looked up
    # rather than deleted — removing a product from an order and adding it
    # back shouldn't silently lose the costing that was entered for it.
    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == sales_order_id).to_list()
    discount_by_product = {costing.product_id: costing.discount for costing in costings if costing.discount}
    return _allocate_line_discounts(discount_by_product, product_ids, quantities, rates)


def _compute_line_items_and_totals(
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    discounts: list[float] | None = None,
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
    if discounts is None:
        discounts = [0.0] * len(quantities)
    line_subtotals = [
        quantity * rate - discount for quantity, rate, discount in zip(quantities, rates, discounts)
    ]
    tax_amounts = [subtotal * (tax_perc / 100) for subtotal, tax_perc in zip(line_subtotals, tax_percs)]
    total_before_tax = sum(line_subtotals)
    total_tax = sum(tax_amounts)
    total_after_tax = total_before_tax + total_tax
    return line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax


async def _insert_sales_summary_rows(
    sales_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    tax_amounts: list[float],
    line_subtotals: list[float],
) -> None:
    for product_id, quantity, rate, tax_perc, tax_amount, line_subtotal in zip(
        product_ids, quantities, rates, tax_percs, tax_amounts, line_subtotals
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
        ).insert()


@router.post("/create_new_sales_order", response_model=CreateNewSalesOrderResponse)
async def create_new_sales_order(
    payload: CreateNewSalesOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewSalesOrderResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)
    await _validate_purchase_orders_exist(payload.related_purchase_order_ids)

    # No discounts term: a sales order can only be costed once it exists,
    # so a brand-new one never has #sales_order_costing rows.
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
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
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        description=payload.description,
        related_purchase_order_ids=payload.related_purchase_order_ids,
    )
    await sales_order.insert()

    await _insert_sales_summary_rows(
        sales_order_id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
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
        line_items = summaries_by_order_id.get(order.id, [])
        response.append(
            SalesOrderDetailItem(
                id=order.id,
                order_no=order.order_no,
                order_status_id=order.order_status_id,
                cust_id=order.cust_id,
                date=order.date,
                product_ids=[item.product_id for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                tax_percs=[item.tax_perc for item in line_items],
                total_amount_before_tax=order.total_amount_before_tax,
                total_tax_amount=order.total_tax_amount,
                total_amount_after_tax=order.total_amount_after_tax,
                description=order.description,
                related_purchase_order_ids=order.related_purchase_order_ids,
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
    await _validate_order_status_exists(payload.order_status_id)

    # Carries any discount already entered on this order's "Add details"
    # sheet through the edit — #sales_summary has no discount column, so
    # re-saving the order form would otherwise quietly undo it.
    discounts = await _stored_line_discounts(
        sales_order.id, payload.product_ids, payload.quantities, payload.rates
    )
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs, discounts)
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
    sales_order.total_amount_before_tax = total_before_tax
    sales_order.total_tax_amount = total_tax
    sales_order.total_amount_after_tax = total_after_tax
    sales_order.description = payload.description
    sales_order.related_purchase_order_ids = payload.related_purchase_order_ids
    sales_order.is_deleted = payload.is_deleted
    # Saving the sales order counts as the admin having reviewed whatever
    # related-PO change set the flag (see SalesOrders.po_updated_flag).
    sales_order.po_updated_flag = False
    await sales_order.save()

    await SalesSummary.find(SalesSummary.sales_order_id == sales_order.id).delete()
    await _insert_sales_summary_rows(
        sales_order.id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_subtotals,
    )

    if holds_stock:
        await apply_sales_order_stock(sales_order.id, payload.product_ids, payload.quantities, stock_deltas)
    else:
        await clear_sales_order_stock(sales_order.id)

    return UpdateSalesOrderDetailsResponse(message="sales order updated successfully")


@router.get("/get_order_status_list", response_model=list[OrderStatusListItem])
async def get_order_status_list(
    _: User | None = Depends(require_admin),
) -> list[OrderStatusListItem]:
    statuses = await OrderStatusMaster.find_all().to_list()
    return [OrderStatusListItem(id=status_row.id, status_name=status_row.status_name) for status_row in statuses]


# ---------------------------------------------------------------------------
# Sales order costing — the "Add details" sheet
# ---------------------------------------------------------------------------
# One row per DISTINCT product on the order rather than per #sales_summary
# line (see models/sales_order_costing.py for why). Everything the sheet
# displays beyond these inputs is derived client-side, as the admin types -
# frontend/src/lib/sales-order-costing.ts holds those formulas.


def _group_line_items_by_product(
    line_items: list[SalesSummary],
) -> tuple[list[int], dict[int, int], dict[int, float], dict[int, float]]:
    # Sorted by id so the sheet's row order matches the order form's line
    # order (#sales_summary rows are inserted in form order and never
    # renumbered by the costing save).
    ordered_product_ids: list[int] = []
    quantity_by_product: dict[int, int] = {}
    rate_by_product: dict[int, float] = {}
    tax_perc_by_product: dict[int, float] = {}

    for item in sorted(line_items, key=lambda line_item: line_item.id):
        if item.product_id not in quantity_by_product:
            ordered_product_ids.append(item.product_id)
            quantity_by_product[item.product_id] = 0
            # The sheet shows a product once, so two lines of the same
            # product at different rates can only surface one of them — the
            # first wins here, and saving the sheet then applies it to both
            # (see update_sales_order_costing).
            rate_by_product[item.product_id] = item.rate
            tax_perc_by_product[item.product_id] = item.tax_perc
        quantity_by_product[item.product_id] += item.quantity

    return ordered_product_ids, quantity_by_product, rate_by_product, tax_perc_by_product


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

    line_items = await SalesSummary.find(SalesSummary.sales_order_id == sales_order_id).to_list()
    product_ids, quantities, rates, tax_percs = _group_line_items_by_product(line_items)

    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == sales_order_id).to_list()
    costings_by_product = {costing.product_id: costing for costing in costings}

    customer = await CustomerDetails.get(sales_order.cust_id)
    order_status = await OrderStatusMaster.get(sales_order.order_status_id)

    lines = []
    for product_id in product_ids:
        product = products_by_id.get(product_id)
        costing = costings_by_product.get(product_id)
        lines.append(
            SalesOrderCostingLine(
                product_id=product_id,
                # A since-deleted product still has to render, hence the
                # placeholder rather than a 404 on the whole sheet.
                model_name=product.product_name if product else f"Product {product_id}",
                quantity=quantities[product_id],
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
                net_sales_rate=rates[product_id],
                discount=costing.discount if costing else 0.0,
                sales_tax_perc=tax_percs[product_id],
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
        lines=lines,
    )


@router.post("/update_sales_order_costing", response_model=UpdateSalesOrderCostingResponse)
async def update_sales_order_costing(
    payload: UpdateSalesOrderCostingRequest,
    _: User | None = Depends(require_admin),
) -> UpdateSalesOrderCostingResponse:
    sales_order = await _get_active_sales_order(payload.sales_order_id)

    line_items = await SalesSummary.find(SalesSummary.sales_order_id == payload.sales_order_id).to_list()
    if not line_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sales order has no line items")

    # All-or-nothing: the sheet always submits every product, so a mismatch
    # means the order's line items changed in another tab since it loaded,
    # and saving a partial set would leave the order's totals wrong.
    order_product_ids = {item.product_id for item in line_items}
    payload_product_ids = {line.product_id for line in payload.lines}
    if payload_product_ids != order_product_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "costing must cover exactly the order's products "
                f"(expected {sorted(order_product_ids)}, got {sorted(payload_product_ids)}) — "
                "the order's line items may have changed; reload and try again"
            ),
        )

    lines_by_product = {line.product_id: line for line in payload.lines}

    # --- sales side: written straight back onto the live line items --------
    # Net Sales Rate and Sales Tax % ARE SalesSummary.rate/tax_perc, so the
    # order row's own totals move with the sheet. Updated in place rather
    # than deleted and reinserted (as update_sales_order_details does) so the
    # row ids — and therefore the sheet's row order — survive a save.
    for item in line_items:
        line = lines_by_product[item.product_id]
        item.rate = line.net_sales_rate
        item.tax_perc = line.sales_tax_perc

    # --- cost side: upserted into #sales_order_costing ---------------------
    costings = await SalesOrderCosting.find(SalesOrderCosting.sales_order_id == payload.sales_order_id).to_list()
    costings_by_product = {costing.product_id: costing for costing in costings}

    for line in payload.lines:
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
        costing = costings_by_product.get(line.product_id)
        if costing is None:
            costing_id = await get_next_id(
                SalesOrderCostingIdCounter, "next_sales_order_costing_id", SalesOrderCosting
            )
            costing = SalesOrderCosting(
                id=costing_id,
                sales_order_id=payload.sales_order_id,
                product_id=line.product_id,
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
    sorted_items = sorted(line_items, key=lambda line_item: line_item.id)
    product_ids = [item.product_id for item in sorted_items]
    quantities = [item.quantity for item in sorted_items]
    rates = [item.rate for item in sorted_items]
    tax_percs = [item.tax_perc for item in sorted_items]
    discounts = _allocate_line_discounts(
        {line.product_id: line.discount for line in payload.lines if line.discount},
        product_ids,
        quantities,
        rates,
    )
    line_subtotals, tax_amounts, total_before_tax, total_tax, total_after_tax = _compute_line_items_and_totals(
        quantities, rates, tax_percs, discounts
    )

    for item, line_subtotal, tax_amount in zip(sorted_items, line_subtotals, tax_amounts):
        item.tax_amount = tax_amount
        item.total = line_subtotal + tax_amount
        await item.save()

    sales_order.total_amount_before_tax = total_before_tax
    sales_order.total_tax_amount = total_tax
    sales_order.total_amount_after_tax = total_after_tax
    await sales_order.save()

    # Quantities are read-only on this sheet, so nothing here can move stock
    # — no #inventory work to do, unlike update_sales_order_details.
    return UpdateSalesOrderCostingResponse(message="sales order details saved successfully")
