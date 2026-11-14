"use client";

// ---------------------------------------------------------------------------
// <TicketThreadModal> — one ticket's conversation, for either side
// ---------------------------------------------------------------------------
// Shared by /admin/tickets and /customer/tickets. Both sides see the same
// thread. What differs is passed in: which side is looking (their own
// messages sit on the right), the calls to load and reply with, and, for the
// team only, onStatusChange, which turns the status pill into a dropdown.
//
// While open it re-reads the ticket every so often, so a reply from the other
// side shows up without closing and reopening.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { StatusSelect } from "@/components/admin/status-select";
import { formatDateTime } from "@/lib/format-date";
import {
  TICKET_STATUSES,
  ticketStatusLabel,
  type TicketDetail,
  type TicketSide,
  type TicketStatus,
} from "@/lib/tickets";
import styles from "@/styles/dashboard.module.css";

const REFRESH_MS = 20_000;

export const TICKET_STATUS_COLOR: Record<TicketStatus, string> = {
  open: styles.statusNew,
  in_progress: styles.statusProcessing,
  resolved: styles.statusCompleted,
  closed: styles.statusDelivered,
};

export function TicketThreadModal({
  ticketId,
  viewer,
  load,
  send,
  onStatusChange,
  onUpdated,
  onClose,
}: {
  ticketId: number;
  viewer: TicketSide;
  load: (ticketId: number) => Promise<TicketDetail>;
  send: (ticketId: number, body: string) => Promise<TicketDetail>;
  onStatusChange?: (ticketId: number, status: TicketStatus) => Promise<TicketDetail>;
  // Lets the list behind the modal pick up a new status or reply count.
  onUpdated: (detail: TicketDetail) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  // The parent's onUpdated is usually an inline arrow; held in a ref so a
  // new one each render doesn't restart the refresh timer.
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  });

  const apply = useCallback((next: TicketDetail) => {
    setDetail(next);
    onUpdatedRef.current(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    function refresh(initial: boolean) {
      load(ticketId)
        .then((data) => {
          if (cancelled) return;
          apply(data);
          setLoadError(null);
        })
        .catch((error: Error) => {
          // A failed background refresh keeps the thread already on screen.
          if (!cancelled && initial) setLoadError(error.message || "Couldn't load this ticket.");
        });
    }

    refresh(true);
    const timer = window.setInterval(() => refresh(false), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ticketId, load, apply]);

  // Scroll to the newest entry when one arrives, not on every refresh.
  useEffect(() => {
    const count = detail?.messages.length ?? 0;
    if (count > lastCountRef.current) {
      threadEndRef.current?.scrollIntoView({ block: "end" });
    }
    lastCountRef.current = count;
  }, [detail]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setActionError(null);
    try {
      apply(await send(ticketId, body));
      setDraft("");
    } catch (error) {
      setActionError((error as Error).message || "Couldn't send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleStatus(status: TicketStatus) {
    if (!onStatusChange || !detail || status === detail.status) return;
    setChangingStatus(true);
    setActionError(null);
    try {
      apply(await onStatusChange(ticketId, status));
    } catch (error) {
      setActionError((error as Error).message || "Couldn't change the status. Please try again.");
    } finally {
      setChangingStatus(false);
    }
  }

  const isClosed = detail?.status === "closed";

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-modal-title"
        className={`${styles.modalPanel} ${styles.ticketPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="ticket-modal-title" className={styles.modalTitle}>
            #{ticketId}
            {detail ? ` · ${detail.subject}` : ""}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          {loadError && (
            <p role="alert" className={styles.formError}>
              {loadError}
            </p>
          )}
          {!detail && !loadError && <p className={styles.pageSubtext}>Loading ticket…</p>}

          {detail && (
            <>
              <div className={styles.ticketMeta}>
                {viewer === "team" && (
                  <div>
                    <span className={styles.formLabel}>Client</span>
                    <p className={styles.formStaticValue}>{detail.customerName}</p>
                  </div>
                )}
                {detail.salesOrderId !== null && (
                  <div>
                    <span className={styles.formLabel}>Order</span>
                    <p className={styles.formStaticValue}>
                      {/* Only the team gets a link: the portal has no order page. */}
                      {viewer === "team" ? (
                        <Link
                          href={`/admin/orders/sales/${detail.salesOrderId}/details`}
                          className={styles.linkButton}
                        >
                          #{detail.orderNo ?? detail.salesOrderId}
                        </Link>
                      ) : (
                        `#${detail.orderNo ?? detail.salesOrderId}`
                      )}
                    </p>
                  </div>
                )}
                <div>
                  <span className={styles.formLabel}>Raised</span>
                  <p className={styles.formStaticValue}>
                    {formatDateTime(detail.createdAt)}
                    {viewer === "team" && detail.raisedBy === "team" ? " · by the team" : ""}
                  </p>
                </div>
                <div>
                  <span className={styles.formLabel}>Status</span>
                  <p className={`${styles.formStaticValue} ${styles.statusText} ${TICKET_STATUS_COLOR[detail.status]}`}>
                    {onStatusChange ? (
                      <StatusSelect
                        value={detail.status}
                        options={TICKET_STATUSES}
                        label={`Status for ticket ${detail.id}`}
                        disabled={changingStatus}
                        onChange={(status) => void handleStatus(status)}
                      />
                    ) : (
                      ticketStatusLabel(detail.status)
                    )}
                  </p>
                </div>
              </div>

              <div className={styles.ticketThread} aria-live="polite">
                {detail.messages.map((message) =>
                  message.kind === "status_change" ? (
                    <p key={message.id} className={styles.ticketEvent}>
                      {message.authorName} marked this{" "}
                      <strong>{message.newStatus ? ticketStatusLabel(message.newStatus) : "updated"}</strong> ·{" "}
                      {formatDateTime(message.createdAt)}
                    </p>
                  ) : (
                    <div
                      key={message.id}
                      className={`${styles.ticketMessage} ${message.side === viewer ? styles.ticketMessageOwn : ""}`}
                    >
                      <p className={styles.ticketMessageMeta}>
                        <span className={styles.ticketMessageAuthor}>
                          {message.side === viewer ? "You" : message.authorName}
                        </span>
                        {message.side === viewer && viewer === "team" ? ` (${message.authorName})` : ""} ·{" "}
                        {formatDateTime(message.createdAt)}
                      </p>
                      <p className={styles.ticketMessageBody}>{message.body}</p>
                    </div>
                  ),
                )}
                <div ref={threadEndRef} />
              </div>

              {actionError && (
                <p role="alert" aria-live="polite" className={styles.formError}>
                  {actionError}
                </p>
              )}

              {isClosed ? (
                <p className={styles.formHint}>
                  {viewer === "team"
                    ? "This ticket is closed. Change its status to reply again."
                    : "This ticket is closed. If you still need help, please raise a new ticket."}
                </p>
              ) : (
                <form onSubmit={handleSend} className={styles.ticketReplyForm}>
                  <label htmlFor="ticket-reply" className={styles.srOnly}>
                    Your reply
                  </label>
                  <textarea
                    id="ticket-reply"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      // Ctrl/Cmd+Enter sends, the way most chat boxes do.
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={3}
                    maxLength={10000}
                    placeholder="Write a reply…"
                    className={styles.formTextarea}
                  />
                  {viewer === "client" && detail.status === "resolved" && (
                    <p className={styles.formHint}>Replying will reopen this ticket.</p>
                  )}
                  <div className={styles.modalActions}>
                    <div className={styles.modalActionsRight}>
                      <Button type="button" variant="tertiary" onClick={onClose}>
                        Close
                      </Button>
                      <Button type="submit" variant="primary" disabled={sending || !draft.trim()}>
                        {sending ? "Sending…" : "Send reply"}
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
