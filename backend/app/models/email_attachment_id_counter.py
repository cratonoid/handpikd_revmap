# Schema for the #email_attachment_id_counter collection. Single document (_id=1) that
# tracks the next auto-generated EmailAttachment.id.
from beanie import Document


class EmailAttachmentIdCounter(Document):
    id: int
    next_email_attachment_id: int

    class Settings:
        name = "email_attachment_id_counter"
