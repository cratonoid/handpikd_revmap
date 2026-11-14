# Schema for the #ticket_id_counter collection.
from beanie import Document


class TicketIdCounter(Document):
    id: int
    next_ticket_id: int

    class Settings:
        name = "ticket_id_counter"
