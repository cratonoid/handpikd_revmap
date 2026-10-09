// ---------------------------------------------------------------------------
// Client loyalty points
// ---------------------------------------------------------------------------
// A client's points are held as separate grants ("lots"), each with its own
// expiry date — see backend/app/models/customer_points_lot.py, and
// backend/app/services/customer_points.py for the rules:
//   - points expire three weeks after they start unless another date is
//     picked, and are worth nothing from their expiry date on;
//   - a standard invoice marked paid earns its client 5% of it;
//   - a sales order can spend at most 5% of its net amount in points, one
//     rupee per point.
// Read on the client form (customer-form-modal.tsx) and on the sales order
// form, which offers them as a discount (sales-order-form-modal.tsx).
import { apiFetch } from "@/lib/api";

// Mirrors MAX_REDEMPTION_RATE in backend/app/services/customer_points.py.
// The backend enforces it; this is only so the form can show the limit.
export const MAX_REDEMPTION_RATE = 0.05;

// Mirrors POINTS_VALIDITY — the default expiry offered when adding points.
export const POINTS_VALIDITY_DAYS = 21;

// Largest whole number of points an order with this net subtotal can take.
// Rounded to the paisa before flooring, like max_redeemable_points, so float
// noise can't move it by a point.
export function maxRedeemablePoints(netSubtotal: number): number {
  return Math.max(Math.floor(Math.round(netSubtotal * MAX_REDEMPTION_RATE * 100) / 100), 0);
}

export type PointsLotStatus = "active" | "expired" | "revoked" | "used";
export type PointsSource = "manual" | "invoice" | "opening_balance";

export type PointsLot = {
  id: number;
  points: number;
  used: number;
  remaining: number;
  // "YYYY-MM-DD" — the first day the lot is worth nothing.
  expiresOn: string;
  createdAt: string;
  source: PointsSource;
  invoiceId: number | null;
  note: string;
  status: PointsLotStatus;
};

export type CustomerPoints = {
  custId: number;
  availablePoints: number;
  // Points the sales order the request was made for already holds from this
  // client. They go back into the pot when that order is re-saved, so the
  // order form can offer availablePoints + orderHeldPoints.
  orderHeldPoints: number;
  lots: PointsLot[];
};

type CustomerPointsResponse = {
  cust_id: number;
  available_points: number;
  order_held_points: number;
  lots: {
    id: number;
    points: number;
    used: number;
    remaining: number;
    expires_on: string;
    created_at: string;
    source: PointsSource;
    invoice_id: number | null;
    note: string;
    status: PointsLotStatus;
  }[];
};

export async function fetchCustomerPoints(custId: number, salesOrderId?: number): Promise<CustomerPoints> {
  const query = salesOrderId !== undefined ? `&sales_order_id=${salesOrderId}` : "";
  const response = await apiFetch(`/admin/get_customer_points?cust_id=${custId}${query}`);
  if (!response.ok) {
    throw new Error("Failed to load points");
  }

  const item: CustomerPointsResponse = await response.json();
  return {
    custId: item.cust_id,
    availablePoints: item.available_points,
    orderHeldPoints: item.order_held_points ?? 0,
    lots: item.lots.map((lot) => ({
      id: lot.id,
      points: lot.points,
      used: lot.used,
      remaining: lot.remaining,
      expiresOn: lot.expires_on,
      createdAt: lot.created_at,
      source: lot.source,
      invoiceId: lot.invoice_id,
      note: lot.note,
      status: lot.status,
    })),
  };
}

// Both resolve to null on success, or the message to show on failure.
async function postForError(path: string, body: unknown): Promise<string | null> {
  try {
    const response = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const detail = await response.json().catch(() => null);
    return typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.";
  } catch {
    return "Couldn't reach the server. Please try again.";
  }
}

export function addCustomerPoints(
  custId: number,
  points: number,
  expiresOn: string,
  note: string,
): Promise<string | null> {
  return postForError("/admin/add_customer_points", {
    cust_id: custId,
    points,
    expires_on: expiresOn || null,
    note,
  });
}

export function revokeCustomerPointsLot(lotId: number): Promise<string | null> {
  return postForError("/admin/revoke_customer_points_lot", { lot_id: lotId });
}

// One row of the Clients page's Points view (client-points-tab.tsx).
export type CustomerPointsSummary = {
  custId: number;
  customerName: string;
  companyOrDepartment: string;
  isDeleted: boolean;
  availablePoints: number;
  // The soonest date any live points expire ("YYYY-MM-DD"), and how many go
  // then. null / 0 when the client has no live points.
  nextExpiryOn: string | null;
  nextExpiryPoints: number;
  // Every point the client has ever spent on sales orders.
  redeemedPoints: number;
};

type CustomerPointsSummaryItem = {
  cust_id: number;
  customer_name: string;
  company_or_department: string;
  is_deleted: boolean;
  available_points: number;
  next_expiry_on: string | null;
  next_expiry_points: number;
  redeemed_points: number;
};

export async function fetchCustomerPointsSummary(): Promise<CustomerPointsSummary[]> {
  const response = await apiFetch("/admin/get_customer_points_summary");
  if (!response.ok) {
    throw new Error("Failed to load points");
  }

  const items: CustomerPointsSummaryItem[] = await response.json();
  return items.map((item) => ({
    custId: item.cust_id,
    customerName: item.customer_name,
    companyOrDepartment: item.company_or_department ?? "",
    isDeleted: item.is_deleted,
    availablePoints: item.available_points,
    nextExpiryOn: item.next_expiry_on,
    nextExpiryPoints: item.next_expiry_points,
    redeemedPoints: item.redeemed_points,
  }));
}
