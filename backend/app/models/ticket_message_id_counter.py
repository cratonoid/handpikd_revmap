# Schema for the #ticket_message_id_counter collection.
from beanie import Document


class TicketMessageIdCounter(Document):
    id: int
    next_ticket_message_id: int

    class Settings:
        name = "ticket_message_id_counter"
