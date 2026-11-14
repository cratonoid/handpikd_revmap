// ---------------------------------------------------------------------------
// Notifications (the bell in the top bar), for the team and for clients
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/notifications.py. Like the backend module,
// this knows nothing about tickets or any other producer. A notification is a
// kind, some text and a link, and the bell renders any of them the same way.
//
// Every call takes the side it's for. The team's endpoints are filtered to
// the sections the member's role grants; the client's only ever return what
// is addressed to that client's login.
import { apiFetch } from "@/lib/api";
import type { SectionKey } from "@/lib/access";

export type AppNotification = {
  id: number;
  // Producer-owned, e.g. "ticket.raised". Only used for display hints.
  kind: string;
  title: string;
  body: string;
  link: string;
  section: SectionKey;
  createdAt: string;
  isRead: boolean;
};

type NotificationItemResponse = {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  section: SectionKey;
  created_at: string;
  is_read: boolean;
};

type UnreadCountResponse = { unread_count: number };

export type NotificationAudience = "team" | "client";

const ENDPOINTS: Record<
  NotificationAudience,
  { list: string; count: string; markRead: string; markAllRead: string }
> = {
  team: {
    list: "/admin/notifications/get_notifications",
    count: "/admin/notifications/get_unread_count",
    markRead: "/admin/notifications/mark_notifications_read",
    markAllRead: "/admin/notifications/mark_all_notifications_read",
  },
  client: {
    list: "/customer/get_my_notifications",
    count: "/customer/get_my_unread_notification_count",
    markRead: "/customer/mark_my_notifications_read",
    markAllRead: "/customer/mark_all_my_notifications_read",
  },
};

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export async function fetchNotifications(
  audience: NotificationAudience,
  limit = 20,
): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const response = await apiFetch(`${ENDPOINTS[audience].list}?limit=${limit}`);
  if (!response.ok) throw new Error("Failed to load notifications");
  const data: { items: NotificationItemResponse[]; unread_count: number } = await response.json();
  return {
    unreadCount: data.unread_count,
    items: data.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      link: item.link,
      section: item.section,
      createdAt: utc(item.created_at),
      isRead: item.is_read,
    })),
  };
}

export async function fetchUnreadNotificationCount(audience: NotificationAudience): Promise<number> {
  const response = await apiFetch(ENDPOINTS[audience].count);
  if (!response.ok) throw new Error("Failed to load notifications");
  const data: UnreadCountResponse = await response.json();
  return data.unread_count;
}

export async function markNotificationsRead(audience: NotificationAudience, ids: number[]): Promise<number> {
  const response = await apiFetch(ENDPOINTS[audience].markRead, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notification_ids: ids }),
  });
  if (!response.ok) throw new Error("Failed to mark notifications read");
  const data: UnreadCountResponse = await response.json();
  return data.unread_count;
}

export async function markAllNotificationsRead(audience: NotificationAudience): Promise<number> {
  const response = await apiFetch(ENDPOINTS[audience].markAllRead, { method: "POST" });
  if (!response.ok) throw new Error("Failed to mark notifications read");
  const data: UnreadCountResponse = await response.json();
  return data.unread_count;
}

// "just now", "5 min ago", "3 h ago", then the date — what a notification
// list wants, rather than a full timestamp on every row.
export function timeAgo(value: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
}
