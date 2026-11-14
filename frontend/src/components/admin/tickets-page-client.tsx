"use client";

// ---------------------------------------------------------------------------
// <TicketsPageClient> — /admin/tickets
// ---------------------------------------------------------------------------
// The shared ticket list (components/tickets/tickets-page.tsx) wired to the
// admin endpoints: every client's tickets, raising on a client's behalf, and
// changing status.
import { TicketsPage, type TicketsApi } from "@/components/tickets/tickets-page";
import { fetchCustomerList } from "@/lib/customers";
import {
  createTicket,
  fetchClientOrders,
  fetchTicketDetail,
  fetchTickets,
  postTicketMessage,
  updateTicketStatus,
} from "@/lib/tickets";

// Module-level, so the page's effects see the same functions every render.
const ADMIN_TICKETS_API: TicketsApi = {
  list: fetchTickets,
  load: fetchTicketDetail,
  send: postTicketMessage,
  create: (custId, subject, message, salesOrderId) => createTicket(custId ?? 0, subject, message, salesOrderId),
  loadOrders: (custId) => (custId === null ? Promise.resolve([]) : fetchClientOrders(custId)),
  updateStatus: updateTicketStatus,
  loadClients: fetchCustomerList,
};

export function TicketsPageClient() {
  return <TicketsPage viewer="team" api={ADMIN_TICKETS_API} />;
}
