# Emails module: the admin's /admin/emails page (templates, signature, send
# history) and the compose screen opened from /admin/database, which sends
# templated, formatted emails to leads or clients through the company's
# Titan mailbox. Vendors are deliberately out of scope.
#
# Every template belongs to one audience (lead or client), and a send is
# refused unless the template and every recipient share it — so a client
# can't be sent the cold-outreach email written for a lead by picking the
# wrong template. Delivery itself runs in the background
# (services/email_sender.py); /send returns as soon as the EmailSend row
# exists and the compose screen polls /get_send for progress.
import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import ValidationError

from app.api.deps import require_section
from app.core.config import settings
from app.models import (
    DatabaseContact,
    EmailAudience,
    EmailAttachment,
    EmailAttachmentIdCounter,
    EmailRecipient,
    EmailSend,
    EmailSendIdCounter,
    EmailSendStatus,
    EmailSettings,
    EmailTemplate,
    EmailTemplateIdCounter,
    RecipientStatus,
    Section,
    TemplateAttachment,
    User,
)
from app.schemas.emails import (
    AddTemplateRequest,
    EmailRecipientItem,
    EmailSendItem,
    EmailSignatureItem,
    EmailStatusResponse,
    EmailTemplateItem,
    RemoveTemplateAttachmentRequest,
    SendEmailRequest,
    SendEmailResponse,
    TemplateAttachmentItem,
    TemplateResponse,
    UpdateSignatureRequest,
    UpdateTemplateRequest,
)
from app.services import email_bounces, email_sender, email_signature
from app.services.counters import get_next_id
from app.services.email_render import unknown_placeholders

router = APIRouter(prefix="/admin/email", tags=["emails"])

_require_emails = require_section(Section.emails)

# The signature logo rides along inside every single email, so it's kept
# small, and to formats every mail client displays inline.
_MAX_LOGO_BYTES = 1024 * 1024
_LOGO_CONTENT_TYPES = {"image/png", "image/jpeg", "image/gif"}
# Stored template files live in Mongo (see models/email_attachment.py), so
# each has to stay well inside the 16MB document limit.
_MAX_TEMPLATE_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Everything attached to one message, stored and on-the-spot files
# together. Titan, like most providers, rejects messages much above this
# once base64 encoding has added its third.
_MAX_SEND_ATTACHMENT_BYTES = 20 * 1024 * 1024
# A "sending" row whose last progress is older than this was cut off by a
# restart: even the slowest message plus the pause between two messages is
# far shorter.
_STALE_SEND_AFTER = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _required(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise _bad_request(f"{field} is required")
    return cleaned


def _check_placeholders(template_audience: EmailAudience, subject: str, body_html: str) -> None:
    unknown = unknown_placeholders(template_audience, subject, body_html)
    if unknown:
        fields = ", ".join("{{" + field + "}}" for field in unknown)
        raise _bad_request(f"{fields} can't be filled in for a {template_audience.value} — remove it or pick another field")


def _to_template_item(template: EmailTemplate) -> EmailTemplateItem:
    return EmailTemplateItem(
        template_id=template.id,
        name=template.name,
        audience=template.audience,
        subject=template.subject,
        body_html=template.body_html,
        attachments=[TemplateAttachmentItem(**attachment.model_dump()) for attachment in template.attachments],
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def _is_interrupted(send: EmailSend) -> bool:
    return send.status == EmailSendStatus.sending and _now() - send.updated_at > _STALE_SEND_AFTER


def _to_send_item(send: EmailSend) -> EmailSendItem:
    interrupted = _is_interrupted(send)
    recipients = [
        EmailRecipientItem(
            contact_id=recipient.contact_id,
            name=recipient.name,
            email=recipient.email,
            # Reported, not written: a local dev server shares production's
            # database, so rewriting rows from here could clobber a send
            # that's genuinely still running on the live server.
            status=RecipientStatus.failed if interrupted and recipient.status == RecipientStatus.pending else recipient.status,
            error=(
                "Sending was interrupted before this email went out."
                if interrupted and recipient.status == RecipientStatus.pending
                else recipient.bounce_reason
                if recipient.status == RecipientStatus.bounced
                else recipient.error
            ),
            saved_to_sent=recipient.saved_to_sent,
            sent_at=recipient.sent_at,
            bounced_at=recipient.bounced_at,
        )
        for recipient in send.recipients
    ]
    return EmailSendItem(
        send_id=send.id,
        audience=send.audience,
        template_id=send.template_id,
        template_name=send.template_name,
        subject=send.subject,
        body_html=send.body_html,
        attachment_names=send.attachment_names,
        status=EmailSendStatus.done if interrupted else send.status,
        interrupted=interrupted,
        total=len(recipients),
        sent_count=sum(1 for recipient in recipients if recipient.status == RecipientStatus.sent),
        failed_count=sum(1 for recipient in recipients if recipient.status == RecipientStatus.failed),
        bounced_count=sum(1 for recipient in recipients if recipient.status == RecipientStatus.bounced),
        recipients=recipients,
        created_at=send.created_at,
    )


async def _get_template_or_404(template_id: int) -> EmailTemplate:
    template = await EmailTemplate.get(template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="template not found")
    return template


# --- status ----------------------------------------------------------------


@router.get("/get_status", response_model=EmailStatusResponse)
async def get_status(_: User | None = Depends(_require_emails)) -> EmailStatusResponse:
    return EmailStatusResponse(
        configured=email_sender.is_configured(),
        from_address=settings.smtp_user,
        from_name=settings.smtp_from_name,
        bulk_limit=settings.email_bulk_limit,
    )


@router.post("/test_connection")
async def test_connection(_: User | None = Depends(_require_emails)) -> dict[str, str]:
    # Logs in to SMTP and IMAP without sending anything, so the settings can
    # be checked without emailing a real contact.
    if not email_sender.is_configured():
        raise _bad_request("Email isn't set up yet — add SMTP_USER and SMTP_PASSWORD to the backend .env.")
    try:
        await asyncio.to_thread(email_sender.check_connection)
    except Exception as error:  # noqa: BLE001 — reported to the admin as-is
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=email_sender.friendly_error(error))
    return {"message": f"Connected to Titan as {settings.smtp_user}."}


# --- templates -------------------------------------------------------------


@router.get("/get_templates", response_model=list[EmailTemplateItem])
async def get_templates(_: User | None = Depends(_require_emails)) -> list[EmailTemplateItem]:
    templates = await EmailTemplate.find_all().sort(+EmailTemplate.name).to_list()
    return [_to_template_item(template) for template in templates]


@router.post("/add_template", response_model=TemplateResponse)
async def add_template(payload: AddTemplateRequest, _: User | None = Depends(_require_emails)) -> TemplateResponse:
    template = EmailTemplate(
        id=0,
        name=_required(payload.name, "template name"),
        audience=payload.audience,
        subject=_required(payload.subject, "subject"),
        body_html=payload.body_html,
    )
    _check_placeholders(template.audience, template.subject, template.body_html)
    template.id = await get_next_id(EmailTemplateIdCounter, "next_email_template_id", EmailTemplate)
    await template.insert()
    return TemplateResponse(message="template added successfully", template=_to_template_item(template))


@router.post("/update_template", response_model=TemplateResponse)
async def update_template(payload: UpdateTemplateRequest, _: User | None = Depends(_require_emails)) -> TemplateResponse:
    template = await _get_template_or_404(payload.template_id)

    if payload.delete:
        await EmailAttachment.find(EmailAttachment.template_id == template.id).delete()
        await template.delete()
        return TemplateResponse(message="template deleted successfully")

    if payload.name is not None:
        template.name = _required(payload.name, "template name")
    if payload.subject is not None:
        template.subject = _required(payload.subject, "subject")
    if payload.body_html is not None:
        template.body_html = payload.body_html
    _check_placeholders(template.audience, template.subject, template.body_html)
    template.updated_at = _now()
    await template.save()
    return TemplateResponse(message="template updated successfully", template=_to_template_item(template))


@router.post("/add_template_attachment", response_model=TemplateResponse)
async def add_template_attachment(
    template_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(_require_emails),
) -> TemplateResponse:
    template = await _get_template_or_404(template_id)
    data = await file.read()
    if not data:
        raise _bad_request("that file is empty")
    if len(data) > _MAX_TEMPLATE_ATTACHMENT_BYTES:
        raise _bad_request("files saved on a template can be at most 10MB — attach bigger ones when sending instead")

    attachment = EmailAttachment(
        id=await get_next_id(EmailAttachmentIdCounter, "next_email_attachment_id", EmailAttachment),
        template_id=template.id,
        filename=file.filename or "attachment",
        content_type=file.content_type or "application/octet-stream",
        size=len(data),
        data=data,
    )
    await attachment.insert()
    template.attachments.append(
        TemplateAttachment(
            attachment_id=attachment.id,
            filename=attachment.filename,
            content_type=attachment.content_type,
            size=attachment.size,
        )
    )
    template.updated_at = _now()
    await template.save()
    return TemplateResponse(message="attachment added successfully", template=_to_template_item(template))


@router.post("/remove_template_attachment", response_model=TemplateResponse)
async def remove_template_attachment(
    payload: RemoveTemplateAttachmentRequest,
    _: User | None = Depends(_require_emails),
) -> TemplateResponse:
    template = await _get_template_or_404(payload.template_id)
    remaining = [attachment for attachment in template.attachments if attachment.attachment_id != payload.attachment_id]
    if len(remaining) == len(template.attachments):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="attachment not found on this template")
    await EmailAttachment.find(
        EmailAttachment.id == payload.attachment_id, EmailAttachment.template_id == template.id
    ).delete()
    template.attachments = remaining
    template.updated_at = _now()
    await template.save()
    return TemplateResponse(message="attachment removed successfully", template=_to_template_item(template))


# --- signature -------------------------------------------------------------


def _to_signature_item(row: EmailSettings | None) -> EmailSignatureItem:
    return EmailSignatureItem(
        signature_html=email_signature.signature_html_for(row),
        show_logo=row.show_logo if row else True,
        has_custom_logo=bool(row and row.logo_data),
    )


@router.get("/get_signature", response_model=EmailSignatureItem)
async def get_signature(_: User | None = Depends(_require_emails)) -> EmailSignatureItem:
    return _to_signature_item(await email_signature.get_settings_row())


@router.post("/update_signature", response_model=EmailSignatureItem)
async def update_signature(
    payload: UpdateSignatureRequest,
    _: User | None = Depends(_require_emails),
) -> EmailSignatureItem:
    row = await email_signature.get_or_create_settings_row()
    row.signature_html = payload.signature_html
    row.show_logo = payload.show_logo
    await row.save()
    return _to_signature_item(row)


@router.get("/get_signature_logo")
async def get_signature_logo(_: User | None = Depends(_require_emails)) -> Response:
    # The logo emails carry right now, for the Signature tab and the
    # compose preview. Served even while switched off, so the tab can show
    # what turning it back on would add.
    row = await email_signature.get_settings_row()
    logo = email_signature.logo_for(row, ignore_hidden=True)
    return Response(content=logo.data, media_type=logo.content_type, headers={"Cache-Control": "no-store"})


@router.post("/upload_signature_logo", response_model=EmailSignatureItem)
async def upload_signature_logo(
    file: UploadFile = File(...),
    _: User | None = Depends(_require_emails),
) -> EmailSignatureItem:
    data = await file.read()
    content_type = (file.content_type or "").lower()
    if content_type not in _LOGO_CONTENT_TYPES:
        raise _bad_request("the logo has to be a PNG, JPG or GIF image")
    if len(data) > _MAX_LOGO_BYTES:
        raise _bad_request("the logo can be at most 1MB — it's embedded in every email you send")
    size = email_signature.image_size(data)
    if size is None:
        raise _bad_request("that file couldn't be read as an image")

    row = await email_signature.get_or_create_settings_row()
    row.logo_data = data
    row.logo_content_type = content_type
    row.logo_width, row.logo_height = size
    row.show_logo = True
    await row.save()
    return _to_signature_item(row)


@router.post("/reset_signature_logo", response_model=EmailSignatureItem)
async def reset_signature_logo(_: User | None = Depends(_require_emails)) -> EmailSignatureItem:
    # Back to the bundled Handpikd logo; hiding the logo altogether is
    # show_logo on update_signature.
    row = await email_signature.get_or_create_settings_row()
    row.logo_data = None
    row.logo_content_type = None
    row.logo_width = None
    row.logo_height = None
    await row.save()
    return _to_signature_item(row)


# --- sending ---------------------------------------------------------------


@router.post("/send", response_model=SendEmailResponse)
async def send_email(
    payload: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    _: User | None = Depends(_require_emails),
) -> SendEmailResponse:
    try:
        request = SendEmailRequest.model_validate(json.loads(payload))
    except (json.JSONDecodeError, ValidationError):
        raise _bad_request("the email couldn't be read — please try again")

    if not email_sender.is_configured():
        raise _bad_request("Email isn't set up yet — add SMTP_USER and SMTP_PASSWORD to the backend .env.")

    subject = _required(request.subject, "subject")
    if not request.body_html.strip():
        raise _bad_request("the email body is empty")
    _check_placeholders(request.audience, subject, request.body_html)

    contact_ids = list(dict.fromkeys(request.contact_ids))
    if len(contact_ids) > settings.email_bulk_limit:
        raise _bad_request(f"at most {settings.email_bulk_limit} recipients can be emailed at once")

    template: EmailTemplate | None = None
    if request.template_id is not None:
        template = await _get_template_or_404(request.template_id)
        if template.audience != request.audience:
            raise _bad_request(
                f"“{template.name}” is a {template.audience.value} template and can't be sent to {request.audience.value}s"
            )

    contacts = {contact.id: contact for contact in await DatabaseContact.find({"_id": {"$in": contact_ids}}).to_list()}
    recipients: list[EmailRecipient] = []
    for contact_id in contact_ids:
        contact = contacts.get(contact_id)
        if contact is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"contact {contact_id} no longer exists")
        if contact.contact_type.value != request.audience.value:
            raise _bad_request(f"{contact.name} is a {contact.contact_type.value}, not a {request.audience.value}")
        if not contact.email:
            raise _bad_request(f"{contact.name} has no email address")
        recipients.append(
            EmailRecipient(
                contact_id=contact.id,
                name=contact.name,
                email=contact.email,
                contact_person=contact.contact_person,
            )
        )

    attachments: list[email_sender.OutgoingAttachment] = []
    if request.template_attachment_ids:
        if template is None:
            raise _bad_request("template attachments were chosen without a template")
        own_ids = {attachment.attachment_id for attachment in template.attachments}
        wanted = [attachment_id for attachment_id in dict.fromkeys(request.template_attachment_ids) if attachment_id in own_ids]
        stored = await EmailAttachment.find({"_id": {"$in": wanted}}).to_list()
        by_id = {attachment.id: attachment for attachment in stored}
        for attachment_id in wanted:
            row = by_id.get(attachment_id)
            if row is not None:
                attachments.append(email_sender.OutgoingAttachment(row.filename, row.content_type, row.data))
    for upload in files:
        data = await upload.read()
        if data:
            attachments.append(
                email_sender.OutgoingAttachment(
                    upload.filename or "attachment", upload.content_type or "application/octet-stream", data
                )
            )
    if sum(len(attachment.data) for attachment in attachments) > _MAX_SEND_ATTACHMENT_BYTES:
        raise _bad_request("attachments add up to more than 20MB — send a link for large files instead")

    send = EmailSend(
        id=await get_next_id(EmailSendIdCounter, "next_email_send_id", EmailSend),
        audience=request.audience,
        template_id=template.id if template else None,
        template_name=template.name if template else None,
        subject=subject,
        body_html=request.body_html,
        attachment_names=[attachment.filename for attachment in attachments],
        recipients=recipients,
    )
    await send.insert()

    signature = await email_signature.load_signature() if request.include_signature else None
    email_sender.start_send(send.id, signature, attachments)
    return SendEmailResponse(message="sending started", send=_to_send_item(send))


@router.get("/get_send", response_model=EmailSendItem)
async def get_send(send_id: int, _: User | None = Depends(_require_emails)) -> EmailSendItem:
    send = await EmailSend.get(send_id)
    if send is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="send not found")
    return _to_send_item(send)


@router.post("/check_bounces")
async def check_bounces(_: User | None = Depends(_require_emails)) -> dict[str, int | str]:
    # The same check the background loop runs every few minutes, on demand.
    if not email_sender.is_configured():
        raise _bad_request("Email isn't set up yet — add SMTP_USER and SMTP_PASSWORD to the backend .env.")
    try:
        found = await email_bounces.check_bounces()
    except Exception as error:  # noqa: BLE001 — reported to the admin as-is
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=email_sender.friendly_error(error))
    if found == 0:
        return {"found": 0, "message": "No new bounces."}
    return {"found": found, "message": f"{found} email{'s' if found != 1 else ''} bounced — marked on the list below."}


@router.get("/get_sends", response_model=list[EmailSendItem])
async def get_sends(_: User | None = Depends(_require_emails)) -> list[EmailSendItem]:
    # The latest 200 is plenty for a history screen; older sends are still
    # in the collection.
    sends = await EmailSend.find_all().sort(-EmailSend.id).limit(200).to_list()
    return [_to_send_item(send) for send in sends]
