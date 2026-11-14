# Schema for the #ticket collection: one support ticket raised for a client,
# either by the client themselves on the portal (/customer/tickets) or by a
# team member on their behalf (/admin/tickets). The conversation itself lives
# in #ticket_message; this row is the header the two lists are drawn from.
from datetime import datetime
from enum import Enum

from beanie import Document


class TicketStatus(str, Enum):
    # Only the team moves a ticket between these (routes/tickets.py). The one
    # exception is a client replying to a resolved ticket, which reopens it —
    # "resolved" means "we think this is done", and a reply says it isn't.
    # A closed ticket takes no further messages from either side until the
    # team reopens it.
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class TicketSide(str, Enum):
    # Which side of the conversation did something — who raised the ticket,
    # who wrote a message. Stored rather than derived from the author's User,
    # because the author can be None (admin screens with auth disabled) and a
    # User can later be deleted.
    client = "client"
    team = "team"


class Ticket(Document):
    id: int
    cust_id: int  # FK -> CustomerDetails.id
    subject: str
    status: TicketStatus = TicketStatus.open
    raised_by: TicketSide
    raised_by_user_id: int | None = None  # FK -> User.id; None with auth disabled
    # All naive UTC, like every other timestamp in the database.
    created_at: datetime
    updated_at: datetime
    # Who spoke last, so each list can flag the tickets waiting on its side:
    # the admin list shows "Awaiting reply" when the client spoke last.
    last_message_at: datetime
    last_message_by: TicketSide

    class Settings:
        name = "ticket"
