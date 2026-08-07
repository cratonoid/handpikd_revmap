// ---------------------------------------------------------------------------
// Sales order data for the /admin/orders "Sales orders" tab
// ---------------------------------------------------------------------------
// Mirrors lib/purchase-orders.ts. Fetches from GET /admin/get_sales_order_details
// (backend/app/api/routes/sales_orders.py), which only ever returns active
// orders — soft-deleted ones are filtered out server-side so they can't be
// viewed.
//
// SalesOrders itself has no line-item field — product/quantity/rate/tax rows
// belong to the separate #sales_summary collection (backend/app/models/
// sales_summary.py), linked back via its sales_order_id FK.
// get_sales_order_details folds those rows back in as parallel
// productIds/quantities/rates/taxPercs arrays, same convention as
// lib/purchase-orders.ts. sales-order-form-modal.tsx submits/edits them the
// same way, as parallel product_ids/quantities/rates/tax_percs arrays, to
// create_new_sales_order/update_sales_order_details.
//
// order_no and order_status_id are backend-assigned on create (order_no via
// OrderNoCounterMaster, order_status_id defaulted to the seeded "New"
// row) — the create request has neither field; only update_sales_order_details
// accepts order_status_id.
import { apiFetch } from "@/lib/api";

export type SalesOrder = {
  id: number;
  orderNo: number;
  orderStatusId: number;
  custId: number;
  date: string;
  productIds: number[];
  quantities: number[];
  rates: number[];
  taxPercs: number[];
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  description: string;
  relatedPurchaseOrderIds: number[];
  isDeleted: boolean;
};

// Shape returned by the backend's SalesOrderDetailItem schema.
type SalesOrderDetailItem = {
  id: number;
  order_no: number;
  order_status_id: number;
  cust_id: number;
  date: string;
  product_ids: number[];
  quantities: number[];
  rates: number[];
  tax_percs: number[];
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  description: string;
  related_purchase_order_ids: number[];
  is_deleted: boolean;
};

function toSalesOrder(item: SalesOrderDetailItem): SalesOrder {
  return {
    id: item.id,
    orderNo: item.order_no,
    orderStatusId: item.order_status_id,
    custId: item.cust_id,
    date: item.date,
    productIds: item.product_ids,
    quantities: item.quantities,
    rates: item.rates,
    taxPercs: item.tax_percs,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
    relatedPurchaseOrderIds: item.related_purchase_order_ids,
    isDeleted: item.is_deleted,
  };
}

export async function fetchSalesOrders(): Promise<SalesOrder[]> {
  const response = await apiFetch("/admin/get_sales_order_details");
  if (!response.ok) {
    throw new Error("Failed to load sales orders");
  }

  const items: SalesOrderDetailItem[] = await response.json();
  return items.map(toSalesOrder);
}
