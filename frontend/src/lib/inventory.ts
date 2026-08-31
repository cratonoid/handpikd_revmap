// ---------------------------------------------------------------------------
// Inventory data for the /admin/inventory "Inventory" and "Inventory
// history" tabs
// ---------------------------------------------------------------------------
// fetchInventory hits GET /admin/get_inventory (backend/app/api/routes/
// inventory.py), which returns one row per product currently in stock —
// products with no Inventory row (never purchased/sold, or sold down to 0
// and dropped, see services/inventory.py) are left out entirely — already
// joined with product_name/hsn_code server-side, unlike most other list
// endpoints in this app which return raw FK ids for the frontend to resolve.
//
// fetchInventoryHistory hits GET /admin/get_inventory_history, the ledger
// written by app/services/inventory.py whenever a purchase order of either
// kind (billed or unbilled) is created or edited, and whenever a sales order
// enters or leaves "Delivered". Editing
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
  // Splits the Inventory tab's Billed/Unbilled views. Both kinds of stock
  // live in the same #inventory collection and move through the same
  // helpers — this flag on the product is the only thing separating them,
  // which is also why an unbilled row's hsnCode is always empty. See
  // backend/app/models/product_details.py's is_unbilled.
  isUnbilled: boolean;
};

// Shape returned by the backend's InventoryItem schema.
type InventoryItemResponse = {
  product_id: number;
  product_name: string;
  hsn_code: string;
  quantity: number;
  is_unbilled: boolean;
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
    isUnbilled: item.is_unbilled,
  }));
}

export type InventoryTransactionType = "purchase" | "unbilled_purchase" | "sales";

export type InventoryHistoryEntry = {
  id: number;
  productId: number;
  transactionType: InventoryTransactionType;
  quantity: number;
  purchaseOrderId: number | null;
  // Set instead of purchaseOrderId on an "unbilled_purchase" row. The two
  // name orders in different collections whose ids overlap, so the history
  // tab resolves each against its own list rather than sharing one lookup.
  unbilledPurchaseOrderId: number | null;
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
  unbilled_purchase_order_id: number | null;
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
    unbilledPurchaseOrderId: item.unbilled_purchase_order_id,
    salesOrderId: item.sales_order_id,
    createdAt: item.created_at,
  }));
}
