// ---------------------------------------------------------------------------
// Dashboard stats for the /admin "Analytical Dashboard" landing page
// ---------------------------------------------------------------------------
// Fetches from GET /admin/get_dashboard_stats (backend/app/api/routes/
// analytics.py), which returns a single set of aggregate counts rather than
// a list — no per-row shape to map here, unlike lib/invoices.ts etc.
import { apiFetch } from "@/lib/api";

export type DashboardStats = {
  totalClients: number;
  openOrders: number;
  pendingQuotations: number;
  unpaidInvoices: number;
};

// Shape returned by the backend's DashboardStatsResponse schema.
type DashboardStatsResponse = {
  total_clients: number;
  open_orders: number;
  pending_quotations: number;
  unpaid_invoices: number;
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
    pendingQuotations: item.pending_quotations,
    unpaidInvoices: item.unpaid_invoices,
  };
}
