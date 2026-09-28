// ---------------------------------------------------------------------------
// Dashboard stats for the /admin "Analytical Dashboard" landing page
// ---------------------------------------------------------------------------
// Fetches from GET /admin/get_dashboard_stats (backend/app/api/routes/
// analytics.py), which returns headline figures plus the small series the
// dashboard charts: orders by status, sales by month, and the latest orders.
import { apiFetch } from "@/lib/api";

export type OrderStatusCount = {
  statusId: number;
  statusName: string;
  count: number;
};

export type MonthlySales = {
  month: string; // "YYYY-MM"
  total: number;
  orderCount: number;
};

export type RecentOrder = {
  id: number;
  orderNo: number;
  customerName: string;
  statusId: number;
  statusName: string;
  date: string;
  totalAmountAfterTax: number;
};

export type DashboardStats = {
  totalClients: number;
  openOrders: number;
  openOrdersValue: number;
  unpaidInvoices: number;
  unpaidAmount: number;
  ordersByStatus: OrderStatusCount[];
  monthlySales: MonthlySales[];
  recentOrders: RecentOrder[];
};

// Shape returned by the backend's DashboardStatsResponse schema.
type DashboardStatsResponse = {
  total_clients: number;
  open_orders: number;
  open_orders_value: number;
  unpaid_invoices: number;
  unpaid_amount: number;
  orders_by_status: { status_id: number; status_name: string; count: number }[];
  monthly_sales: { month: string; total: number; order_count: number }[];
  recent_orders: {
    id: number;
    order_no: number;
    customer_name: string;
    status_id: number;
    status_name: string;
    date: string;
    total_amount_after_tax: number;
  }[];
};

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await apiFetch("/admin/get_dashboard_stats");
  if (!response.ok) {
    throw new Error("Failed to load dashboard stats");
  }

  const item: DashboardStatsResponse = await response.json();
  return {
    totalClients: item.total_clients,
    openOrders: item.open_orders,
    openOrdersValue: item.open_orders_value,
    unpaidInvoices: item.unpaid_invoices,
    unpaidAmount: item.unpaid_amount,
    ordersByStatus: item.orders_by_status.map((row) => ({
      statusId: row.status_id,
      statusName: row.status_name,
      count: row.count,
    })),
    monthlySales: item.monthly_sales.map((row) => ({
      month: row.month,
      total: row.total,
      orderCount: row.order_count,
    })),
    recentOrders: item.recent_orders.map((row) => ({
      id: row.id,
      orderNo: row.order_no,
      customerName: row.customer_name,
      statusId: row.status_id,
      statusName: row.status_name,
      date: row.date,
      totalAmountAfterTax: row.total_amount_after_tax,
    })),
  };
}

// "₹1,23,456" — Indian digit grouping, no paise: dashboard figures are
// headlines, not ledger entries.
export function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

// "₹1.2L" / "₹3.4Cr" / "₹12.5K" — for chart labels where the full figure
// won't fit above a bar.
export function formatRupeesCompact(value: number): string {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (value >= 1_00_000) return `₹${(value / 1_00_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}
