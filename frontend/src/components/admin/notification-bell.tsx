"use client";

// ---------------------------------------------------------------------------
// <NotificationBell> — the top bar's notification bell and panel
// ---------------------------------------------------------------------------
// Renders whatever the notification module holds for the signed-in team
// member or client (lib/notifications.ts); `audience` picks which. It doesn't know what a ticket is. Each
// notification brings its own title, text and link, so any module that
// starts calling notify() on the backend shows up here with no change.
//
// Delivery is polling: the unread count every POLL_MS while the tab is
// visible, plus once on every navigation. It's the simplest thing that works
// behind nginx with no extra infrastructure. Moving to server push later
// (SSE or a websocket) only changes how `refreshCount` gets called. The
// panel and the API stay as they are.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BellIcon } from "@/components/icons";
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationsRead,
  timeAgo,
  type AppNotification,
  type NotificationAudience,
} from "@/lib/notifications";
import styles from "@/styles/dashboard.module.css";

const POLL_MS = 30_000;

export function NotificationBell({ audience }: { audience: NotificationAudience }) {
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    fetchUnreadNotificationCount(audience)
      .then(setUnread)
      .catch(() => {
        // Keep the last count. A missed poll isn't worth an error on screen.
      });
  }, [audience]);

  useEffect(() => {
    queueMicrotask(refreshCount);
  }, [refreshCount, pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshCount();
    }, POLL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") refreshCount();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  // Load the list each time the panel opens, so it's never stale.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchNotifications(audience)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setUnread(data.unreadCount);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, audience]);

  // Click outside or Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleOpenItem(item: AppNotification) {
    setOpen(false);
    if (!item.isRead) {
      setItems((previous) => previous?.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry)) ?? null);
      setUnread((count) => Math.max(0, count - 1));
      markNotificationsRead(audience, [item.id]).then(setUnread).catch(() => refreshCount());
    }
    if (item.link) router.push(item.link);
  }

  async function handleMarkAll() {
    setItems((previous) => previous?.map((entry) => ({ ...entry, isRead: true })) ?? null);
    setUnread(0);
    try {
      setUnread(await markAllNotificationsRead(audience));
    } catch {
      refreshCount();
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={wrapRef} className={styles.notificationWrap}>
      <button
        type="button"
        className={styles.notificationButton}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && <span className={styles.notificationBadge}>{badge}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className={styles.notificationPanel}>
          <div className={styles.notificationPanelHeader}>
            <span className={styles.notificationPanelTitle}>Notifications</span>
            {unread > 0 && (
              <button type="button" className={styles.linkButton} onClick={() => void handleMarkAll()}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.notificationList}>
            {items === null && !loadFailed && <p className={styles.notificationEmpty}>Loading…</p>}
            {loadFailed && <p className={styles.notificationEmpty}>Couldn&apos;t load notifications.</p>}
            {items !== null && items.length === 0 && (
              <p className={styles.notificationEmpty}>You&apos;re all caught up.</p>
            )}
            {items?.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void handleOpenItem(item)}
                className={`${styles.notificationItem} ${item.isRead ? "" : styles.notificationItemUnread}`}
              >
                <span className={styles.notificationItemTitle}>{item.title}</span>
                {item.body && <span className={styles.notificationItemBody}>{item.body}</span>}
                <span className={styles.notificationItemTime}>{timeAgo(item.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
