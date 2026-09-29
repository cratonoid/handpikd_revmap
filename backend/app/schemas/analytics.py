# Request/response bodies for the analytics module's endpoints.
from datetime import datetime

from pydantic import BaseModel


class OrderStatusCount(BaseModel):
    status_id: int
    status_name: str
    count: int


class MonthlySales(BaseModel):
    month: str  # "YYYY-MM"
    total: float
    order_count: int


class RecentOrder(BaseModel):
    id: int
    order_no: int
    customer_name: str
    status_id: int
    status_name: str
    date: datetime
    total_amount_before_tax: float


class DashboardStatsResponse(BaseModel):
    total_clients: int
    open_orders: int
    open_orders_value: float
    unpaid_invoices: int
    unpaid_amount: float
    orders_by_status: list[OrderStatusCount]
    monthly_sales: list[MonthlySales]
    recent_orders: list[RecentOrder]
