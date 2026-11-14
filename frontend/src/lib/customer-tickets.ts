// ---------------------------------------------------------------------------
// Support tickets for the client portal's /customer/tickets screen
// ---------------------------------------------------------------------------
// The client-side counterpart to lib/tickets.ts, kept apart for the same
// reason lib/customer-invoices.ts is: nothing here may reach an /admin
// endpoint. Every call goes to /customer, where the backend scopes it to the
// signed-in client (backend/app/api/routes/tickets.py). There is no client id
// to pass, and no way to ask for anyone else's ticket.
import { apiFetch } from "@/lib/api";
import {
  errorDetail,
  orderOptionsOrThrow,
  postJson,
  toTicket,
  toTicketDetail,
  type Ticket,
  type TicketDetail,
  type TicketListItemResponse,
  type TicketOrderOption,
} from "@/lib/tickets";

export async function fetchMyTickets(): Promise<Ticket[]> {
  const response = await apiFetch("/customer/get_my_tickets");
  if (!response.ok) throw new Error("Failed to load tickets");
  const items: TicketListItemResponse[] = await response.json();
  return items.map(toTicket);
}

async function detailOrThrow(response: Response, fallback: string): Promise<TicketDetail> {
  if (!response.ok) throw new Error(await errorDetail(response, fallback));
  return toTicketDetail(await response.json());
}

export async function fetchMyTicketDetail(ticketId: number): Promise<TicketDetail> {
  return detailOrThrow(
    await apiFetch(`/customer/get_my_ticket_details?ticket_id=${ticketId}`),
    "Failed to load ticket",
  );
}

// The signed-in client's own orders, for the "Related order" picker.
export async function fetchMyTicketOrders(): Promise<TicketOrderOption[]> {
  return orderOptionsOrThrow(await apiFetch("/customer/get_my_ticket_orders"));
}

export async function createMyTicket(
  subject: string,
  message: string,
  salesOrderId: number | null,
): Promise<TicketDetail> {
  return detailOrThrow(
    await postJson("/customer/create_my_ticket", { subject, message, sales_order_id: salesOrderId }),
    "Failed to raise ticket",
  );
}

export async function postMyTicketMessage(ticketId: number, body: string): Promise<TicketDetail> {
  return detailOrThrow(
    await postJson("/customer/post_my_ticket_message", { ticket_id: ticketId, body }),
    "Failed to send message",
  );
}
