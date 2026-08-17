// ---------------------------------------------------------------------------
// Inventory data for the /admin/inventory "Inventory" and "Inventory
// history" tabs
// ---------------------------------------------------------------------------
// fetchInventory hits GET /admin/get_inventory (backend/app/api/routes/
// inventory.py), which returns one row per product — including products
// that have never been purchased or sold, defaulted to quantity 0 — already
// joined with product_name/hsn_code server-side, unlike most other list
// endpoints in this app which return raw FK ids for the frontend to resolve.
//
// fetchInventoryHistory hits GET /admin/get_inventory_history, the ledger
// written by app/services/inventory.py whenever a purchase order is created
// or edited, and whenever a sales order enters or leaves "Delivered". Editing
// an order rewrites its rows rather than appending to them, so the ledger
// always reflects the stock those orders currently hold. It only returns raw
// product_id/purchase_order_id
// /sales_order_id FKs, so the history tab resolves product/order names
// itself against fetchProducts()/fetchPurchaseOrders()/fetchSalesOrders(),
// same convention as sales-orders-tab.tsx.
import { apiFetch } from "@/lib/api";

export type InventoryItem = {
  productId: number;
  productName: string;
  hsnCode: string;
  quantity: number;
};

// Shape returned by the backend's InventoryItem schema.
type InventoryItemResponse = {
  product_id: number;
  product_name: string;
  hsn_code: string;
  quantity: number;
};

export async function fetchInventory(): Promise<InventoryItem[]> {
  const response = await apiFetch("/admin/get_inventory");
  if (!response.ok) {
    throw new Error("Failed to load inventory");
  }

  const items: InventoryItemResponse[] = await response.json();
  return items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
    hsnCode: item.hsn_code,
    quantity: item.quantity,
  }));
}

export type InventoryTransactionType = "purchase" | "sales";

export type InventoryHistoryEntry = {
  id: number;
  productId: number;
  transactionType: InventoryTransactionType;
  quantity: number;
  purchaseOrderId: number | null;
  salesOrderId: number | null;
  createdAt: string;
};

// Shape returned by the backend's InventoryHistoryItem schema.
type InventoryHistoryItemResponse = {
  id: number;
  product_id: number;
  transaction_type: string;
  quantity: number;
  purchase_order_id: number | null;
  sales_order_id: number | null;
  created_at: string;
};

export async function fetchInventoryHistory(): Promise<InventoryHistoryEntry[]> {
  const response = await apiFetch("/admin/get_inventory_history");
  if (!response.ok) {
    throw new Error("Failed to load inventory history");
  }

  const items: InventoryHistoryItemResponse[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    productId: item.product_id,
    transactionType: item.transaction_type as InventoryTransactionType,
    quantity: item.quantity,
    purchaseOrderId: item.purchase_order_id,
    salesOrderId: item.sales_order_id,
    createdAt: item.created_at,
  }));
}
