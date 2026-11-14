# Schema for the #ticket_message collection: one entry in a ticket's thread
# (see models/ticket.py). Most are messages someone wrote; a status change
# made by the team is recorded here too (kind == status_change), so both
# sides see when and why a ticket moved without reading a separate log.
from datetime import datetime
from enum import Enum

from beanie import Document

from app.models.ticket import TicketSide, TicketStatus


class TicketMessageKind(str, Enum):
    message = "message"
    status_change = "status_change"


class TicketMessage(Document):
    id: int
    ticket_id: int  # FK -> Ticket.id
    kind: TicketMessageKind = TicketMessageKind.message
    side: TicketSide
    author_user_id: int | None = None  # FK -> User.id; None with auth disabled
    # Snapshotted at write time, so a renamed team member or client doesn't
    # rewrite who said what in an old thread.
    author_name: str
    # Empty on a status_change entry.
    body: str = ""
    # status_change only: the status the ticket moved to.
    new_status: TicketStatus | None = None
    created_at: datetime  # naive UTC

    class Settings:
        name = "ticket_message"
        indexes = ["ticket_id"]
