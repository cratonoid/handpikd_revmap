// ---------------------------------------------------------------------------
// Purchase order data for the /admin/orders "Purchase orders" tab
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts. Fetches from GET /admin/get_purchase_order_details
// (not yet implemented on the backend — see backend/app/models/purchase_orders.py),
// expected to return every purchase order as a flat list.
//
// PurchaseOrders itself has no line-item field — product/quantity/rate rows
// belong to the separate #purchase_summary collection
// (backend/app/models/purchase_summary.py), which currently has no FK back
// to a purchase order. Until that link exists, the form's line items
// (purchase-order-form-modal.tsx) stay client-side only — used to compute
// total_amount_before_tax — rather than being submitted or persisted
// individually.
import { apiFetch } from "@/lib/api";

export type PurchaseOrder = {
  id: number;
  purchaseOrderNo: number;
  vendorId: number;
  totalAmountBeforeTax: number;
  sgstAmount: number | null;
  cgstAmount: number | null;
  igstAmount: number | null;
  totalAmountAfterTax: number;
  description: string;
};

// Shape expected from the backend's future PurchaseOrderDetailItem schema.
type PurchaseOrderDetailItem = {
  id: number;
  purchase_order_no: number;
  vendor_id: number;
  total_amount_before_tax: number;
  sgst_amount: number | null;
  cgst_amount: number | null;
  igst_amount: number | null;
  total_amount_after_tax: number;
  description: string;
};

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
    totalAmountBeforeTax: item.total_amount_before_tax,
    sgstAmount: item.sgst_amount,
    cgstAmount: item.cgst_amount,
    igstAmount: item.igst_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
  }));
}
