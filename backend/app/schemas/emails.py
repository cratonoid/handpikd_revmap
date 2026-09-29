# Request/response bodies for the Emails module's endpoints
# (routes/emails.py): templates, the signature, sending and send history.
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.email_send import EmailSendStatus, RecipientStatus
from app.models.email_template import EmailAudience


class EmailStatusResponse(BaseModel):
    # False until SMTP_USER / SMTP_PASSWORD are set in the backend .env.
    configured: bool
    from_address: str
    from_name: str
    bulk_limit: int


class TemplateAttachmentItem(BaseModel):
    attachment_id: int
    filename: str
    content_type: str
    size: int


class EmailTemplateItem(BaseModel):
    template_id: int
    name: str
    audience: EmailAudience
    subject: str
    body_html: str
    attachments: list[TemplateAttachmentItem]
    created_at: datetime
    updated_at: datetime


class AddTemplateRequest(BaseModel):
    name: str = Field(min_length=1)
    audience: EmailAudience
    subject: str = Field(min_length=1)
    body_html: str


class TemplateResponse(BaseModel):
    message: str
    template: EmailTemplateItem | None = None


# None leaves a field as it is. `delete` on its own removes the template and
# its stored attachments. The audience can't change: a template's wording
# (and its placeholders) are written for one kind of recipient.
class UpdateTemplateRequest(BaseModel):
    template_id: int
    name: str | None = None
    subject: str | None = None
    body_html: str | None = None
    delete: bool = False


class RemoveTemplateAttachmentRequest(BaseModel):
    template_id: int
    attachment_id: int


class EmailSignatureItem(BaseModel):
    signature_html: str
    # Whether emails carry the logo under the signature, and whether it's
    # one uploaded here rather than the bundled Handpikd logo.
    show_logo: bool
    has_custom_logo: bool


class UpdateSignatureRequest(BaseModel):
    signature_html: str
    show_logo: bool = True


# Sent as the JSON `payload` field of the multipart /send request, next to
# any files attached on the spot.
class SendEmailRequest(BaseModel):
    audience: EmailAudience
    contact_ids: list[int] = Field(min_length=1)
    template_id: int | None = None
    subject: str
    body_html: str
    # Which of the template's own attachments go out with this send; any
    # left out were removed in the compose screen for this send only.
    template_attachment_ids: list[int] = []
    include_signature: bool = True


class EmailRecipientItem(BaseModel):
    contact_id: int
    name: str
    email: str
    status: RecipientStatus
    error: str | None
    saved_to_sent: bool
    sent_at: datetime | None
    bounced_at: datetime | None = None


class EmailSendItem(BaseModel):
    send_id: int
    audience: EmailAudience
    template_id: int | None
    template_name: str | None
    subject: str
    body_html: str
    attachment_names: list[str]
    status: EmailSendStatus
    # True when a "sending" row stopped moving — the server restarted
    # mid-send and the pending recipients never got their email.
    interrupted: bool
    total: int
    # sent_count is delivered-and-not-bounced.
    sent_count: int
    failed_count: int
    bounced_count: int
    recipients: list[EmailRecipientItem]
    created_at: datetime


class SendEmailResponse(BaseModel):
    message: str
    send: EmailSendItem
