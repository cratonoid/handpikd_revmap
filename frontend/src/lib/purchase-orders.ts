// ---------------------------------------------------------------------------
// Purchase order data for the /admin/orders "Purchase orders" tab
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts. Fetches from GET /admin/get_purchase_order_details
// (backend/app/api/routes/orders.py), expected to return every purchase
// order as a flat list.
//
// PurchaseOrders itself has no line-item field — product/quantity/rate rows
// belong to the separate #purchase_summary collection
// (backend/app/models/purchase_summary.py), linked back via its
// purchase_order_id FK. get_purchase_order_details folds those rows back in
// as parallel productIds/quantities/rates arrays (raw ids, same convention
// as vendorId on ProductDetailItem — the frontend resolves names against
// its own vendor/product lists rather than the backend embedding them).
// purchase-order-form-modal.tsx submits/edits them the same way, as parallel
// product_ids/quantities/rates arrays, to create_new_purchase_order /
// update_purchase_order_details.
import { apiFetch } from "@/lib/api";

export type PurchaseOrder = {
  id: number;
  purchaseOrderNo: string;
  vendorId: number;
  productIds: number[];
  quantities: number[];
  rates: number[];
  totalAmountBeforeTax: number;
  // Percentages (not rupee amounts) applied to totalAmountBeforeTax — see
  // purchase-order-form-modal.tsx.
  sgstPerc: number | null;
  cgstPerc: number | null;
  igstPerc: number | null;
  totalAmountAfterTax: number;
  description: string;
};

// Shape returned by the backend's PurchaseOrderDetailItem schema.
type PurchaseOrderDetailItem = {
  id: number;
  purchase_order_no: string;
  vendor_id: number;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  total_amount_before_tax: number;
  sgst_perc: number | null;
  cgst_perc: number | null;
  igst_perc: number | null;
  total_amount_after_tax: number;
  description: string;
};

export type PurchaseOrderOption = {
  id: number;
  purchaseOrderNo: string;
  vendorName: string;
};

// Shape returned by the backend's PurchaseOrderListItem schema.
type PurchaseOrderListItem = {
  id: number;
  purchase_order_no: string;
  vendor_name: string;
};

// Lightweight id+PO no.+vendor name list for the "related purchase orders"
// multiselect on the sales order popup — PurchaseOrders has no is_deleted, so
// unlike get_vendors_list/get_customer_list there's no active/deleted split
// to worry about here.
export async function fetchPurchaseOrderList(): Promise<PurchaseOrderOption[]> {
  const response = await apiFetch("/admin/get_purchase_order_list");
  if (!response.ok) {
    throw new Error("Failed to load purchase orders");
  }

  const items: PurchaseOrderListItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorName: item.vendor_name,
  }));
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const response = await apiFetch("/admin/get_purchase_order_details");
  if (!response.ok) {
    throw new Error("Failed to load purchase orders");
  }

  const items: PurchaseOrderDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    purchaseOrderNo: item.purchase_order_no,
    vendorId: item.vendor_id,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    totalAmountBeforeTax: item.total_amount_before_tax,
    sgstPerc: item.sgst_perc,
    cgstPerc: item.cgst_perc,
    igstPerc: item.igst_perc,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
  }));
}
