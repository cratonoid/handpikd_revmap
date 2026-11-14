// ---------------------------------------------------------------------------
// Support tickets: shared shapes, plus the admin calls for /admin/tickets
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/tickets.py. The client portal's calls are
// in lib/customer-tickets.ts. They return the same shapes, but only reach
// /customer endpoints, which are scoped to the signed-in client server-side.
import { apiFetch } from "@/lib/api";

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketSide = "client" | "team";
export type TicketMessageKind = "message" | "status_change";

export const TICKET_STATUSES: readonly { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export function ticketStatusLabel(status: TicketStatus): string {
  return TICKET_STATUSES.find((option) => option.value === status)?.label ?? status;
}

export type Ticket = {
  id: number;
  custId: number;
  customerName: string;
  subject: string;
  status: TicketStatus;
  raisedBy: TicketSide;
  createdAt: string;
  lastMessageAt: string;
  lastMessageBy: TicketSide;
  messageCount: number;
};

export type TicketMessage = {
  id: number;
  kind: TicketMessageKind;
  side: TicketSide;
  authorName: string;
  body: string;
  newStatus: TicketStatus | null;
  createdAt: string;
};

export type TicketDetail = Ticket & { messages: TicketMessage[] };

// Shapes returned by the backend's TicketListItem / TicketDetail schemas.
export type TicketListItemResponse = {
  id: number;
  cust_id: number;
  customer_name: string;
  subject: string;
  status: TicketStatus;
  raised_by: TicketSide;
  created_at: string;
  last_message_at: string;
  last_message_by: TicketSide;
  message_count: number;
};

export type TicketDetailResponse = TicketListItemResponse & {
  messages: {
    id: number;
    kind: TicketMessageKind;
    side: TicketSide;
    author_name: string;
    body: string;
    new_status: TicketStatus | null;
    created_at: string;
  }[];
};

// Backend datetimes are naive UTC. Marking them as such lets formatDateTime
// render them in Indian time instead of printing the UTC clock as-is.
export function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export function toTicket(item: TicketListItemResponse): Ticket {
  return {
    id: item.id,
    custId: item.cust_id,
    customerName: item.customer_name,
    subject: item.subject,
    status: item.status,
    raisedBy: item.raised_by,
    createdAt: utc(item.created_at),
    lastMessageAt: utc(item.last_message_at),
    lastMessageBy: item.last_message_by,
    messageCount: item.message_count,
  };
}

export function toTicketDetail(item: TicketDetailResponse): TicketDetail {
  return {
    ...toTicket(item),
    messages: item.messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      side: message.side,
      authorName: message.author_name,
      body: message.body,
      newStatus: message.new_status,
      createdAt: utc(message.created_at),
    })),
  };
}

// The backend's 400s carry a readable `detail` ("this ticket is closed…"),
// which is worth showing as-is rather than a generic failure.
export async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    return typeof data?.detail === "string" ? data.detail : fallback;
  } catch {
    return fallback;
  }
}

async function detailOrThrow(response: Response, fallback: string): Promise<TicketDetail> {
  if (!response.ok) throw new Error(await errorDetail(response, fallback));
  return toTicketDetail(await response.json());
}

export function postJson(path: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Admin calls
// ---------------------------------------------------------------------------
export async function fetchTickets(): Promise<Ticket[]> {
  const response = await apiFetch("/admin/tickets/get_tickets");
  if (!response.ok) throw new Error("Failed to load tickets");
  const items: TicketListItemResponse[] = await response.json();
  return items.map(toTicket);
}

export async function fetchTicketDetail(ticketId: number): Promise<TicketDetail> {
  return detailOrThrow(
    await apiFetch(`/admin/tickets/get_ticket_details?ticket_id=${ticketId}`),
    "Failed to load ticket",
  );
}

export async function createTicket(custId: number, subject: string, message: string): Promise<TicketDetail> {
  return detailOrThrow(
    await postJson("/admin/tickets/create_ticket", { cust_id: custId, subject, message }),
    "Failed to raise ticket",
  );
}

export async function postTicketMessage(ticketId: number, body: string): Promise<TicketDetail> {
  return detailOrThrow(
    await postJson("/admin/tickets/post_ticket_message", { ticket_id: ticketId, body }),
    "Failed to send message",
  );
}

export async function updateTicketStatus(ticketId: number, status: TicketStatus): Promise<TicketDetail> {
  return detailOrThrow(
    await postJson("/admin/tickets/update_ticket_status", { ticket_id: ticketId, status }),
    "Failed to update status",
  );
}

