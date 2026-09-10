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
  // Flat discount off the whole order's net (pre-tax) amount, entered on the
  // order form. It is already baked into the three totals below — the
  // backend splits it across the line items before charging tax (see
  // _allocate_overall_discount in backend/app/api/routes/sales_orders.py) —
  // so nothing here should ever subtract it a second time.
  overallDiscount: number;
  // Delivery billed to the customer, and the GST % it carries. Also already
  // inside the three totals below — the backend adds it on top of the line
  // items and taxes it in its own right (see SalesOrders.delivery_charge).
  // Both 0 on an order with no delivery, and on every order raised before
  // the field existed.
  deliveryCharge: number;
  deliveryTaxPerc: number;
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  description: string;
  relatedPurchaseOrderIds: number[];
  // Unbilled purchase orders this sales order is fulfilled from — a separate
  // list because the two live in different collections with overlapping ids.
  // See backend/app/models/sales_orders.py.
  relatedUnbilledPurchaseOrderIds: number[];
  // True once a related purchase order (on EITHER list above) has been
  // edited since this sales order was last saved — a review notice, not an
  // automatic data sync; see backend/app/models/sales_orders.py's
  // po_updated_flag docstring. Cleared server-side the next time this sales
  // order is saved via update_sales_order_details.
  poUpdatedFlag: boolean;
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
  overall_discount: number;
  delivery_charge: number;
  delivery_tax_perc: number;
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  description: string;
  related_purchase_order_ids: number[];
  related_unbilled_purchase_order_ids: number[];
  po_updated_flag: boolean;
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
    // ?? 0 for orders raised before order-level discounts existed.
    overallDiscount: item.overall_discount ?? 0,
    // ?? 0 for orders raised before delivery charges existed.
    deliveryCharge: item.delivery_charge ?? 0,
    deliveryTaxPerc: item.delivery_tax_perc ?? 0,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    description: item.description,
    relatedPurchaseOrderIds: item.related_purchase_order_ids,
    relatedUnbilledPurchaseOrderIds: item.related_unbilled_purchase_order_ids ?? [],
    poUpdatedFlag: item.po_updated_flag,
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

// Backs the status dropdown in each row of the sales orders table. Its own
// endpoint rather than a full update_sales_order_details round trip: that
// one re-saves the whole order (rewriting the line items, recomputing the
// totals, clearing poUpdatedFlag), none of which changing a status should do.
//
// It can legitimately fail — moving an order into "Delivered"/"Completed"
// takes its quantities out of stock, and the backend rejects the move when
// there isn't enough — so the caller gets the reason back rather than a
// boolean. Resolves to null on success, or the message to show on failure.
export async function updateSalesOrderStatus(id: number, orderStatusId: number): Promise<string | null> {
  try {
    const response = await apiFetch("/admin/update_sales_order_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, order_status_id: orderStatusId }),
    });

    if (response.ok) {
      return null;
    }

    // Surface the backend's actual reason (e.g. "insufficient stock for:
    // product 12 (on hand 3, needs 2 more)") instead of guessing.
    const body = await response.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : "Couldn't update the status. Please try again.";
  } catch {
    return "Couldn't reach the server. Please try again.";
  }
}
