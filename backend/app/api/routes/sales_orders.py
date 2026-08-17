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
    ProductDetails,
    PurchaseOrders,
    SalesOrderIdCounter,
    SalesOrders,
    SalesSummary,
    SalesSummaryIdCounter,
    User,
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
from app.services.inventory import get_current_quantities, record_sale_fulfilled

router = APIRouter(prefix="/admin", tags=["sales_orders"])

_NEW_STATUS_NAME = "New"


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


async def _validate_sufficient_stock(product_ids: list[int], quantities: list[int]) -> None:
    # A product can appear more than once across a single order's line
    # items — quantities are summed per product before comparing against
    # what's on hand, rather than checking each line item in isolation.
    requested_by_product_id: dict[int, int] = {}
    for product_id, quantity in zip(product_ids, quantities):
        requested_by_product_id[product_id] = requested_by_product_id.get(product_id, 0) + quantity

    available_by_product_id = await get_current_quantities(list(requested_by_product_id))
    shortages = [
        f"product {product_id} (available {available_by_product_id.get(product_id, 0)}, requested {requested})"
        for product_id, requested in requested_by_product_id.items()
        if requested > available_by_product_id.get(product_id, 0)
    ]
    if shortages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"insufficient stock for: {', '.join(shortages)}",
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


def _compute_line_items_and_totals(
    quantities: list[int], rates: list[float], tax_percs: list[float]
) -> tuple[list[float], list[float], float, float, float]:
    line_totals_before_tax = [quantity * rate for quantity, rate in zip(quantities, rates)]
    tax_amounts = [
        line_total * (tax_perc / 100) for line_total, tax_perc in zip(line_totals_before_tax, tax_percs)
    ]
    total_before_tax = sum(line_totals_before_tax)
    total_tax = sum(tax_amounts)
    total_after_tax = total_before_tax + total_tax
    return line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax


async def _insert_sales_summary_rows(
    sales_order_id: int,
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    tax_amounts: list[float],
    line_totals_before_tax: list[float],
) -> None:
    for product_id, quantity, rate, tax_perc, tax_amount, line_total_before_tax in zip(
        product_ids, quantities, rates, tax_percs, tax_amounts, line_totals_before_tax
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
            total=line_total_before_tax + tax_amount,
        ).insert()


@router.post("/create_new_sales_order", response_model=CreateNewSalesOrderResponse)
async def create_new_sales_order(
    payload: CreateNewSalesOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewSalesOrderResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)
    await _validate_purchase_orders_exist(payload.related_purchase_order_ids)
    await _validate_sufficient_stock(payload.product_ids, payload.quantities)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
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
        line_totals_before_tax,
    )
    await record_sale_fulfilled(sales_order_id, payload.product_ids, payload.quantities)

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

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

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
        line_totals_before_tax,
    )

    return UpdateSalesOrderDetailsResponse(message="sales order updated successfully")


@router.get("/get_order_status_list", response_model=list[OrderStatusListItem])
async def get_order_status_list(
    _: User | None = Depends(require_admin),
) -> list[OrderStatusListItem]:
    statuses = await OrderStatusMaster.find_all().to_list()
    return [OrderStatusListItem(id=status_row.id, status_name=status_row.status_name) for status_row in statuses]
