"use client";

// ---------------------------------------------------------------------------
// <TicketsPage> — the ticket list, shared by /admin/tickets and
// /customer/tickets
// ---------------------------------------------------------------------------
// The two screens are the same list with a few differences, all decided by
// `viewer` and the `api` passed in. The team sees a Client column and can
// change status. The portal shows only the signed-in client's own tickets.
// Each side's "waiting on you" flag points at the other side's last message.
//
// ?ticket=<id> opens that ticket on arrival. The notification bell links here
// that way (backend/app/api/routes/tickets.py's _ticket_link).
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { NewTicketModal } from "@/components/tickets/new-ticket-modal";
import { TICKET_STATUS_COLOR, TicketThreadModal } from "@/components/tickets/ticket-thread-modal";
import { formatDateTime } from "@/lib/format-date";
import type { CustomerOption } from "@/lib/customers";
import {
  ticketStatusLabel,
  type Ticket,
  type TicketDetail,
  type TicketSide,
  type TicketStatus,
} from "@/lib/tickets";
import styles from "@/styles/dashboard.module.css";

export type TicketsApi = {
  list: () => Promise<Ticket[]>;
  load: (ticketId: number) => Promise<TicketDetail>;
  send: (ticketId: number, body: string) => Promise<TicketDetail>;
  create: (custId: number | null, subject: string, message: string) => Promise<TicketDetail>;
  // Team only.
  updateStatus?: (ticketId: number, status: TicketStatus) => Promise<TicketDetail>;
  loadClients?: () => Promise<CustomerOption[]>;
};

type Filter = "active" | "resolved" | "closed" | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function matchesFilter(ticket: Ticket, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return ticket.status === "open" || ticket.status === "in_progress";
  return ticket.status === filter;
}

// True when the other side spoke last on a ticket that's still in play.
function isWaitingOn(ticket: Ticket, viewer: TicketSide): boolean {
  return ticket.lastMessageBy !== viewer && (ticket.status === "open" || ticket.status === "in_progress");
}

type LoadState = "loading" | "loaded" | "failed";

export function TicketsPage({ viewer, api }: { viewer: TicketSide; api: TicketsApi }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<Filter>("active");
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [clients, setClients] = useState<CustomerOption[] | undefined>(undefined);

  const { list, loadClients } = api;

  useEffect(() => {
    let cancelled = false;
    list()
      .then((data) => {
        if (cancelled) return;
        setTickets(data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [list]);

  useEffect(() => {
    if (!loadClients) return;
    let cancelled = false;
    loadClients()
      .then((data) => {
        if (!cancelled) setClients(data);
      })
      .catch(() => {
        // The picker just stays empty. Raising for a client then fails with
        // "please choose the client", which is accurate enough.
        if (!cancelled) setClients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadClients]);

  // Deep link from a notification. Re-runs when the query changes, so
  // clicking a second notification while already on this page still opens it.
  const linkedTicket = searchParams.get("ticket");
  useEffect(() => {
    const id = Number(linkedTicket);
    if (linkedTicket && Number.isInteger(id) && id > 0) {
      queueMicrotask(() => setOpenTicketId(id));
    }
  }, [linkedTicket]);

  // Folds a freshly loaded ticket back into the list (new status, new reply).
  const upsert = useCallback((detail: TicketDetail) => {
    setTickets((previous) => {
      const { messages: _messages, ...row } = detail;
      void _messages;
      const others = previous.filter((ticket) => ticket.id !== row.id);
      return [row, ...others].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id - a.id);
    });
  }, []);

  function closeThread() {
    setOpenTicketId(null);
    if (linkedTicket) router.replace(pathname);
  }

  const visible = tickets.filter((ticket) => matchesFilter(ticket, filter));
  const waitingCount = tickets.filter((ticket) => isWaitingOn(ticket, viewer)).length;

  return (
    <>
      <div className={styles.pageHeaderWithTabs}>
        <h1 className={styles.pageHeading}>{viewer === "team" ? "Tickets" : "Support tickets"}</h1>
        <div className={styles.viewToggle} role="tablist" aria-label="Ticket status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`${styles.viewToggleButton} ${filter === option.value ? styles.viewToggleButtonActive : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.pageHeaderAction}>
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            {viewer === "team" ? "+ Raise for a client" : "+ Raise a ticket"}
          </Button>
        </div>
      </div>

      <p className={styles.pageSubtext}>
        {viewer === "team"
          ? `Tickets raised by clients, or by the team on their behalf. ${
              waitingCount > 0 ? `${waitingCount} awaiting a reply from us.` : "Nothing is awaiting a reply."
            }`
          : "Questions or problems with an order or invoice? Raise a ticket and our team will reply here."}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Ticket</th>
              <th className={styles.tableHeadCell}>Subject</th>
              {viewer === "team" && <th className={styles.tableHeadCell}>Client</th>}
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Messages</th>
              <th className={styles.tableHeadCell}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((ticket) => (
              <tr key={ticket.id} onClick={() => setOpenTicketId(ticket.id)} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>#{ticket.id}</td>
                <td className={styles.tableCell}>
                  {ticket.subject}
                  {isWaitingOn(ticket, viewer) && (
                    <span className={styles.ticketWaitingBadge}>
                      {viewer === "team" ? "Awaiting reply" : "New reply"}
                    </span>
                  )}
                </td>
                {viewer === "team" && <td className={styles.tableCell}>{ticket.customerName}</td>}
                <td className={`${styles.tableCell} ${styles.statusText} ${TICKET_STATUS_COLOR[ticket.status]}`}>
                  {ticketStatusLabel(ticket.status)}
                </td>
                <td className={styles.tableCell}>{ticket.messageCount}</td>
                <td className={styles.tableCell}>{formatDateTime(ticket.lastMessageAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadState === "loading" && <p className={styles.pageSubtext}>Loading tickets…</p>}
        {loadState === "failed" && (
          <p role="alert" className={styles.formError}>
            Couldn&apos;t load tickets. Please refresh the page or try again shortly.
          </p>
        )}
        {loadState === "loaded" && visible.length === 0 && (
          <p className={styles.pageSubtext}>
            {tickets.length === 0 ? "No tickets yet." : "No tickets in this view."}
          </p>
        )}
      </div>

      {creating && (
        <NewTicketModal
          clients={viewer === "team" ? (clients ?? []) : undefined}
          onCreate={api.create}
          onCreated={(detail) => {
            upsert(detail);
            setCreating(false);
            setFilter("active");
            setOpenTicketId(detail.id);
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {openTicketId !== null && (
        <TicketThreadModal
          key={openTicketId}
          ticketId={openTicketId}
          viewer={viewer}
          load={api.load}
          send={api.send}
          onStatusChange={api.updateStatus}
          onUpdated={upsert}
          onClose={closeThread}
        />
      )}
    </>
  );
}
