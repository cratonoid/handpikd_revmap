# Schema for the #email_attachments collection: the files attached to an
# EmailTemplate by default (a catalogue PDF, a price list). Stored in Mongo
# rather than on disk so they need no volume of their own and a local dev
# server — whose MONGODB_URI points at the shared database — reads the same
# files production does. Files are capped well below Mongo's 16MB document
# limit (see _MAX_TEMPLATE_ATTACHMENT_BYTES in routes/emails.py).
#
# Files added on the spot in the compose screen are never stored: they go
# out with that one send and only their names are kept on the EmailSend.
from datetime import datetime, timezone

from beanie import Document
from pydantic import Field


class EmailAttachment(Document):
    id: int
    template_id: int
    filename: str
    content_type: str
    size: int
    data: bytes
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    class Settings:
        name = "email_attachments"
