// ---------------------------------------------------------------------------
// The admin panel's notifications (the bell in the top bar)
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/notifications.py. Like the backend module,
// this knows nothing about tickets or any other producer. A notification is a
// kind, some text and a link, and the bell renders any of them the same way.
// The backend already filters the list to the sections the signed-in team
// member's role grants.
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

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export async function fetchNotifications(limit = 20): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const response = await apiFetch(`/admin/notifications/get_notifications?limit=${limit}`);
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

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await apiFetch("/admin/notifications/get_unread_count");
  if (!response.ok) throw new Error("Failed to load notifications");
  const data: UnreadCountResponse = await response.json();
  return data.unread_count;
}

export async function markNotificationsRead(ids: number[]): Promise<number> {
  const response = await apiFetch("/admin/notifications/mark_notifications_read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notification_ids: ids }),
  });
  if (!response.ok) throw new Error("Failed to mark notifications read");
  const data: UnreadCountResponse = await response.json();
  return data.unread_count;
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await apiFetch("/admin/notifications/mark_all_notifications_read", { method: "POST" });
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
