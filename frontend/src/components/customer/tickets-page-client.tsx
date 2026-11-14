"use client";

// ---------------------------------------------------------------------------
// <CustomerTicketsPageClient> — /customer/tickets
// ---------------------------------------------------------------------------
// The shared ticket list (components/tickets/tickets-page.tsx) wired to the
// /customer endpoints in lib/customer-tickets.ts, which only ever return the
// signed-in client's own tickets. No status control: only the team sets that.
import { TicketsPage, type TicketsApi } from "@/components/tickets/tickets-page";
import {
  createMyTicket,
  fetchMyTicketDetail,
  fetchMyTicketOrders,
  fetchMyTickets,
  postMyTicketMessage,
} from "@/lib/customer-tickets";

const CUSTOMER_TICKETS_API: TicketsApi = {
  list: fetchMyTickets,
  load: fetchMyTicketDetail,
  send: postMyTicketMessage,
  create: (_custId, subject, message, salesOrderId) => createMyTicket(subject, message, salesOrderId),
  // The backend knows whose orders from the login, so the id is ignored.
  loadOrders: () => fetchMyTicketOrders(),
};

export function CustomerTicketsPageClient() {
  return <TicketsPage viewer="client" api={CUSTOMER_TICKETS_API} />;
}
