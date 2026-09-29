# Schema for the #email_sends collection: one row per press of "Send" on the
# compose screen, whether to one contact or many. Recipients are embedded
# with their own status, since a bulk send goes out one message at a time in
# the background (services/email_sender.py) and the compose screen polls
# this row to show progress. Each recipient's name and address are copied in
# at send time, so the history still reads correctly after the contact is
# edited or deleted.
from datetime import datetime, timezone
from enum import Enum

from beanie import Document
from pydantic import BaseModel, Field

from app.models.email_template import EmailAudience


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EmailSendStatus(str, Enum):
    sending = "sending"
    done = "done"


class RecipientStatus(str, Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"


class EmailRecipient(BaseModel):
    contact_id: int
    name: str
    email: str
    contact_person: str | None = None
    status: RecipientStatus = RecipientStatus.pending
    error: str | None = None
    # False when the message went out but couldn't be filed into the Titan
    # Sent folder — the recipient still got it.
    saved_to_sent: bool = False
    sent_at: datetime | None = None


class EmailSend(Document):
    id: int
    audience: EmailAudience
    # Null when composed from scratch rather than from a template. The name
    # is copied so history survives the template being renamed or deleted.
    template_id: int | None = None
    template_name: str | None = None
    # As composed, placeholders and all — each recipient got these with
    # their own details filled in.
    subject: str
    body_html: str
    attachment_names: list[str] = []
    recipients: list[EmailRecipient]
    status: EmailSendStatus = EmailSendStatus.sending
    created_at: datetime = Field(default_factory=_now)
    # Bumped after every recipient; a "sending" row that stops moving was
    # cut off by a server restart (see _is_interrupted in routes/emails.py).
    updated_at: datetime = Field(default_factory=_now)

    class Settings:
        name = "email_sends"
