# Schema for the #email_templates collection: the reusable emails on the
# admin's /admin/emails page (routes/emails.py). Each template is written for
# exactly one audience — leads or clients — and the compose screen only
# offers a template to recipients of that type, so a client never receives
# the cold-outreach email meant for a lead. Subject and body may carry
# {{placeholders}}, filled in per recipient at send time (see
# services/email_render.py for the fields each audience allows).
from datetime import datetime, timezone
from enum import Enum

from beanie import Document
from pydantic import BaseModel, Field


class EmailAudience(str, Enum):
    # Same values as ContactType's, so a contact's type compares directly.
    # No vendor: the Emails module deliberately doesn't write to vendors.
    client = "client"
    lead = "lead"


class TemplateAttachment(BaseModel):
    # Points at an EmailAttachment row, which holds the bytes; kept here so
    # listing templates never has to load file contents.
    attachment_id: int
    filename: str
    content_type: str
    size: int


class EmailTemplate(Document):
    id: int
    name: str
    audience: EmailAudience
    subject: str
    # Formatted body as produced by the compose editor (a small whitelist of
    # tags — see frontend components/admin/rich-text-editor.tsx).
    body_html: str
    # Attached by default whenever this template is used; each can still be
    # dropped for a single send.
    attachments: list[TemplateAttachment] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    class Settings:
        name = "email_templates"
