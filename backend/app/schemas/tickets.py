# Request/response bodies for the support ticket endpoints (routes/tickets.py),
# shared by the admin screen and the client portal. Both sides see the same
# thread. The only differences are which tickets a list covers and who may
# change a ticket's status.
from datetime import datetime

from pydantic import BaseModel

from app.models.ticket import TicketSide, TicketStatus
from app.models.ticket_message import TicketMessageKind


class TicketListItem(BaseModel):
    id: int
    cust_id: int
    # "Name · Department", as every other admin picker labels a client.
    customer_name: str
    subject: str
    status: TicketStatus
    raised_by: TicketSide
    # Naive UTC, like every other timestamp the API returns.
    created_at: datetime
    last_message_at: datetime
    last_message_by: TicketSide
    message_count: int


class TicketMessageItem(BaseModel):
    id: int
    kind: TicketMessageKind
    side: TicketSide
    author_name: str
    body: str
    new_status: TicketStatus | None
    created_at: datetime


class TicketDetail(TicketListItem):
    messages: list[TicketMessageItem]


class CreateMyTicketRequest(BaseModel):
    subject: str
    message: str


class CreateTicketRequest(CreateMyTicketRequest):
    # The client the team is raising this on behalf of.
    cust_id: int


class PostTicketMessageRequest(BaseModel):
    ticket_id: int
    body: str


class UpdateTicketStatusRequest(BaseModel):
    ticket_id: int
    status: TicketStatus
