# Request/response bodies for the analytics module's endpoints.
from pydantic import BaseModel


class DashboardStatsResponse(BaseModel):
    total_clients: int
    open_orders: int
    pending_quotations: int
    unpaid_invoices: int
