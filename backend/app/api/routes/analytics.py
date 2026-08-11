# Analytics module: read-only aggregate counts backing the admin dashboard's
# stat cards (frontend app/admin/page.tsx). Restricted to admins (bypassed
# entirely when settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
from beanie.operators import In, NE
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    InvoiceDetails,
    InvoiceStatus,
    OrderStatusMaster,
    QuotationDetails,
    QuotationStatus,
    SalesOrders,
    User,
)
from app.schemas.analytics import DashboardStatsResponse

router = APIRouter(prefix="/admin", tags=["analytics"])

# "Open" means not yet in the terminal order-lifecycle state — same
# _ORDER_STATUS_SEED ("Completed") looked up by name as sales_orders.py's
# _get_new_status_id does for "New".
_COMPLETED_STATUS_NAME = "Completed"
_PENDING_QUOTATION_STATUSES = [QuotationStatus.draft, QuotationStatus.sent]
_UNPAID_INVOICE_STATUSES = [InvoiceStatus.new, InvoiceStatus.submitted]


async def _get_completed_status_id() -> int:
    completed_status = await OrderStatusMaster.find_one(OrderStatusMaster.status_name == _COMPLETED_STATUS_NAME)
    if completed_status is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="order statuses not seeded")
    return completed_status.id


@router.get("/get_dashboard_stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    _: User | None = Depends(require_admin),
) -> DashboardStatsResponse:
    completed_status_id = await _get_completed_status_id()

    total_clients = await CustomerDetails.find(CustomerDetails.is_deleted == False).count()
    open_orders = await SalesOrders.find(
        SalesOrders.is_deleted == False, NE(SalesOrders.order_status_id, completed_status_id)
    ).count()
    pending_quotations = await QuotationDetails.find(
        QuotationDetails.is_deleted == False, In(QuotationDetails.status, _PENDING_QUOTATION_STATUSES)
    ).count()
    unpaid_invoices = await InvoiceDetails.find(
        InvoiceDetails.is_deleted == False, In(InvoiceDetails.status, _UNPAID_INVOICE_STATUSES)
    ).count()

    return DashboardStatsResponse(
        total_clients=total_clients,
        open_orders=open_orders,
        pending_quotations=pending_quotations,
        unpaid_invoices=unpaid_invoices,
    )
