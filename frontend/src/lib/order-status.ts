// ---------------------------------------------------------------------------
// Order status master data for the sales order status picker
// ---------------------------------------------------------------------------
// Fetches from GET /admin/get_order_status_list (backend/app/api/routes/
// sales_orders.py), which returns the fixed, seeded OrderStatusMaster rows
// (Pending/Confirmed/Shipped/Delivered/Cancelled) unfiltered — this is just
// the dropdown's source list, not a per-order active/deleted split (that's
// handled by fetchSalesOrders/is_deleted on SalesOrders itself).
import { apiFetch } from "@/lib/api";

export type OrderStatus = {
  id: number;
  statusName: string;
};

// Shape returned by the backend's OrderStatusListItem schema.
type OrderStatusListItem = {
  id: number;
  status_name: string;
};

export async function fetchOrderStatusList(): Promise<OrderStatus[]> {
  const response = await apiFetch("/admin/get_order_status_list");
  if (!response.ok) {
    throw new Error("Failed to load order statuses");
  }

  const items: OrderStatusListItem[] = await response.json();
  return items.map((item) => ({ id: item.id, statusName: item.status_name }));
}
