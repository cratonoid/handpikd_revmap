# Schema for the #email_send_id_counter collection. Single document (_id=1) that
# tracks the next auto-generated EmailSend.id.
from beanie import Document


class EmailSendIdCounter(Document):
    id: int
    next_email_send_id: int

    class Settings:
        name = "email_send_id_counter"
