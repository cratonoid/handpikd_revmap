// The private Porter tracking relay (backend/app/api/routes/tracking.py).
// Admin: turn a Porter tracking link into a /track/<id> link for the
// customer. Customer: the sanitized progress of their delivery. Porter's own
// link never reaches the customer's page.
import { API_BASE_URL, apiFetch } from "@/lib/api";

export type TrackingState = "active" | "finished" | "deactivated";

// Our own delivery statuses (backend services/porter_tracking.py _STATUS).
export const TRACK_STATUS_LABELS: Record<string, string> = {
  searching: "Finding a driver",
  to_pickup: "Driver assigned, picking up your order",
  at_pickup: "Your order is being loaded",
  on_the_way: "On the way to you",
  arrived: "Driver has arrived",
  delivered: "Delivered",
  cancelled: "Delivery cancelled",
  unknown: "Awaiting update",
};

export function trackStatusLabel(status: string | null): string {
  return (status && TRACK_STATUS_LABELS[status]) || TRACK_STATUS_LABELS.unknown;
}

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

// --- Admin --------------------------------------------------------------
export type TrackingLink = {
  id: string;
  porterUrl: string;
  label: string;
  state: TrackingState;
  status: string | null;
  lastUpdated: string | null;
  lastError: string | null;
  createdAt: string;
  expiresAt: string;
};

type TrackingLinkResponse = {
  link_id: string;
  porter_url: string;
  label: string | null;
  state: TrackingState;
  status: string | null;
  last_updated: string | null;
  last_error: string | null;
  created_at: string;
  expires_at: string;
};

function toLink(item: TrackingLinkResponse): TrackingLink {
  return {
    id: item.link_id,
    porterUrl: item.porter_url,
    label: item.label ?? "",
    state: item.state,
    status: item.status,
    lastUpdated: item.last_updated ? utc(item.last_updated) : null,
    lastError: item.last_error,
    createdAt: utc(item.created_at),
    expiresAt: utc(item.expires_at),
  };
}

// The same check the backend makes, so a wrong paste is caught at once.
export function isPorterTrackingUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["porter.in", "www.porter.in"].includes(url.hostname)) return false;
    return /^\/rd\/[A-Za-z0-9_-]{4,40}\/?$/.test(url.pathname) || /track_live_order/.test(url.pathname);
  } catch {
    return false;
  }
}

export function customerLink(id: string): string {
  return `${window.location.origin}/track/${id}`;
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") return body.detail.charAt(0).toUpperCase() + body.detail.slice(1);
  return fallback;
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await apiFetch(`/admin/tracking/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await detailOr(response, "Couldn't save. Please try again."));
  return response;
}

export async function fetchTrackingLinks(): Promise<TrackingLink[]> {
  const response = await apiFetch("/admin/tracking/get_links");
  if (!response.ok) throw new Error("Failed to load tracking links.");
  const items: TrackingLinkResponse[] = await response.json();
  return items.map(toLink);
}

export async function createTrackingLink(porterUrl: string, label: string): Promise<TrackingLink> {
  const response = await post("create_link", { porter_url: porterUrl.trim(), label: label.trim() || null });
  return toLink(await response.json());
}

export async function deactivateTrackingLink(id: string): Promise<TrackingLink> {
  const response = await post("deactivate_link", { link_id: id });
  return toLink(await response.json());
}

export async function deleteTrackingLink(id: string): Promise<void> {
  await post("delete_link", { link_id: id });
}

// --- Customer -------------------------------------------------------------
export type TrackPoint = { lat: number; lng: number };

export type Tracking = {
  status: string;
  finished: boolean;
  driverFirstName: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  driver: TrackPoint | null;
  drop: TrackPoint | null;
  etaSeconds: number | null;
  lastUpdated: string;
};

// null: the link doesn't exist or has expired.
export async function fetchTracking(id: string): Promise<Tracking | null> {
  const response = await fetch(`${API_BASE_URL}/track/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`tracking request failed (${response.status})`);
  const body: {
    status: string;
    finished: boolean;
    driver_first_name: string | null;
    vehicle_type: string | null;
    vehicle_number: string | null;
    driver: TrackPoint | null;
    drop: TrackPoint | null;
    eta_seconds: number | null;
    last_updated: string;
  } = await response.json();
  return {
    status: body.status,
    finished: body.finished,
    driverFirstName: body.driver_first_name,
    vehicleType: body.vehicle_type,
    vehicleNumber: body.vehicle_number,
    driver: body.driver,
    drop: body.drop,
    etaSeconds: body.eta_seconds,
    lastUpdated: utc(body.last_updated),
  };
}
