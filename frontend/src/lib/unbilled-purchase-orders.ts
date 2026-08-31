// ---------------------------------------------------------------------------
// Unbilled purchase order data for the Unbilled section of the /admin/orders
// "Purchase orders" tab
// ---------------------------------------------------------------------------
// Mirrors lib/purchase-orders.ts, against
// backend/app/api/routes/unbilled_orders.py. An unbilled purchase is stock
// bought without a bill — cash at a local market — so the shape here is much
// thinner than its billed twin's: there is no taxKind, no sgst/cgst/igst, no
// per-line gstPercs and no before/after-tax pair, only what was paid. No
// purchase invoice is raised either, which is why nothing in this module
// touches lib/purchase-invoices.ts.
//
// Line items are the usual parallel arrays, with one addition. A line can
// name a product that does not exist yet — that is the point of the feature
// — so productIds carries a null there and productNames fills the gap; the
// backend creates the product from the name and reuses it the next time the
// same name is typed. Reading an order back, every line has resolved to a
// real product, so productIds is plain numbers and productNames is what the
// backend joined in for display.
import { apiFetch } from "@/lib/api";

export type UnbilledPurchaseOrder = {
  id: number;
  // "UPO-<id>", assigned by the backend — there is no vendor document to
  // take a number from, so unlike the billed side this is never edited.
  purchaseOrderNo: string;
  vendorId: number;
  date: string;
  productIds: number[];
  // Resolved server-side, unlike every other list in this app, because these
  // products are filtered out of the storefront and the billed pickers and
  // so aren't in any list the page already holds.
  productNames: string[];
  quantities: number[];
  rates: number[];
  // One figure, not a before/after-tax pair: no GST was charged.
  totalAmount: number;
  description: string;
};

// Shape returned by the backend's UnbilledPurchaseOrderDetailItem schema.
type UnbilledPurchaseOrderDetailItem = {
  id: number;
  purchase_order_no: string;
  vendor_id: number;
  date: string;
  product_ids: number[];
  product_names: string[];
  quantities: number[];
  rates: number[];
  total_amount: number;
  description: string;
};

export type UnbilledPurchaseOrderOption = {
  id: number;
  purchaseOrderNo: string;
  vendorName: string;
};

type UnbilledPurchaseOrderListItem = {
  id: number;
  purchase_order_no: string;
  vendor_name: string;
};

// An unbilled product a purchase line can point at instead of creating one.
// Served narrowed to live unbilled products (GET /admin/get_unbilled_products)
// rather than filtered out of fetchProducts() on the client, so a line can
// never be pointed at a billed product by accident.
export type UnbilledProductOption = {
  id: number;
  productName: string;
  vendorRate: number;
};

type UnbilledProductListItem = {
  id: number;
  product_name: string;
  vendor_rate: number;
};

export async function fetchUnbilledPurchaseOrders(): Promise<UnbilledPurchaseOrder[]> {
  const response = await apiFetch("/admin/get_unbilled_purchase_order_details");
  if (!response.ok) {
    throw new Error("Failed to load unbilled purchase orders");
  }

  const items: UnbilledPurchaseOrderDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorId: item.vendor_id,
    date: item.date,
    productIds: item.product_ids,
    productNames: item.product_names,
    quantities: item.quantities,
    rates: item.rates,
    totalAmount: item.total_amount,
    description: item.description,
  }));
}

// Lightweight list for the "related unbilled purchases" multiselect on the
// sales order popup — the twin of fetchPurchaseOrderList.
export async function fetchUnbilledPurchaseOrderList(): Promise<UnbilledPurchaseOrderOption[]> {
  const response = await apiFetch("/admin/get_unbilled_purchase_order_list");
  if (!response.ok) {
    throw new Error("Failed to load unbilled purchase orders");
  }

  const items: UnbilledPurchaseOrderListItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorName: item.vendor_name,
  }));
}

export async function fetchUnbilledProducts(): Promise<UnbilledProductOption[]> {
  const response = await apiFetch("/admin/get_unbilled_products");
  if (!response.ok) {
    throw new Error("Failed to load unbilled products");
  }

  const items: UnbilledProductListItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    productName: item.product_name,
    vendorRate: item.vendor_rate,
  }));
}
