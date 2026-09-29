# Analytics module: read-only aggregates backing the admin dashboard
# (frontend components/admin/dashboard-page-client.tsx). Restricted to admins
# (bypassed entirely when settings.auth_enabled is False, matching
# require_staff in api/deps.py).
from datetime import datetime

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.models import (
    Section,
    CustomerDetails,
    InvoiceDetails,
    InvoiceStatus,
    OrderStatusMaster,
    SalesOrders,
    User,
)
from app.models.invoice_details import InvoiceType
from app.schemas.analytics import (
    DashboardStatsResponse,
    MonthlySales,
    OrderStatusCount,
    RecentOrder,
)

router = APIRouter(prefix="/admin", tags=["analytics"])

# "Open" means not yet in the terminal order-lifecycle state — same
# _ORDER_STATUS_SEED ("Completed") looked up by name as sales_orders.py's
# _get_new_status_id does for "New".
_COMPLETED_STATUS_NAME = "Completed"
_SALES_TREND_MONTHS = 6
_RECENT_ORDERS_LIMIT = 5


def _last_month_keys(count: int, today: datetime) -> list[str]:
    """The `count` most recent "YYYY-MM" keys, oldest first, ending with today's month."""
    year, month = today.year, today.month
    keys = []
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(keys))


@router.get("/get_dashboard_stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    _: User | None = Depends(require_section(Section.dashboard)),
) -> DashboardStatsResponse:
    order_statuses = await OrderStatusMaster.find_all().sort("+_id").to_list()
    status_names = {order_status.id: order_status.status_name for order_status in order_statuses}
    completed_status_id = next(
        (status_id for status_id, name in status_names.items() if name == _COMPLETED_STATUS_NAME), None
    )
    if completed_status_id is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="order statuses not seeded")

    total_clients = await CustomerDetails.find(CustomerDetails.is_deleted == False).count()

    # A small business's order book — loading it once and totalling in Python
    # is simpler than four separate aggregation pipelines.
    orders = await SalesOrders.find(SalesOrders.is_deleted == False).to_list()

    open_orders = [order for order in orders if order.order_status_id != completed_status_id]

    status_counts = {status_id: 0 for status_id in status_names}
    for order in orders:
        if order.order_status_id in status_counts:
            status_counts[order.order_status_id] += 1

    month_keys = _last_month_keys(_SALES_TREND_MONTHS, datetime.now())
    monthly = {key: [0.0, 0] for key in month_keys}
    for order in orders:
        key = f"{order.date.year:04d}-{order.date.month:02d}"
        if key in monthly:
            monthly[key][0] += order.total_amount_after_tax
            monthly[key][1] += 1

    # Receivables follow the client portal's rule: only tax (standard)
    # invoices are owed — nothing is due on a proforma.
    unpaid = await InvoiceDetails.find(
        InvoiceDetails.is_deleted == False,
        InvoiceDetails.status == InvoiceStatus.unpaid,
        InvoiceDetails.type == InvoiceType.standard,
    ).to_list()

    recent = sorted(orders, key=lambda order: (order.date, order.id), reverse=True)[:_RECENT_ORDERS_LIMIT]
    recent_customer_ids = list({order.cust_id for order in recent})
    customers = await CustomerDetails.find(In(CustomerDetails.id, recent_customer_ids)).to_list()
    customer_names = {customer.id: customer.registered_name for customer in customers}

    return DashboardStatsResponse(
        total_clients=total_clients,
        open_orders=len(open_orders),
        open_orders_value=round(sum(order.total_amount_after_tax for order in open_orders), 2),
        unpaid_invoices=len(unpaid),
        unpaid_amount=round(sum(invoice.total_amount_after_tax for invoice in unpaid), 2),
        orders_by_status=[
            OrderStatusCount(status_id=status_id, status_name=status_names[status_id], count=count)
            for status_id, count in status_counts.items()
        ],
        monthly_sales=[
            MonthlySales(month=key, total=round(total, 2), order_count=count)
            for key, (total, count) in monthly.items()
        ],
        recent_orders=[
            RecentOrder(
                id=order.id,
                order_no=order.order_no,
                customer_name=customer_names.get(order.cust_id, "—"),
                status_id=order.order_status_id,
                status_name=status_names.get(order.order_status_id, "—"),
                date=order.date,
                total_amount_after_tax=order.total_amount_after_tax,
            )
            for order in recent
        ],
    )
