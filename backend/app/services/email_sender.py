# Delivers an EmailSend through the company's Titan mailbox, one
# personalised message per recipient, in the background: routes/emails.py
# creates the EmailSend row, starts start_send() and returns straight away,
# and the compose screen polls the row for progress.
#
# Each message is submitted over SMTP and then filed into the mailbox's Sent
# folder over IMAP. SMTP alone never puts anything in Sent, so without the
# second step mail sent from the app would be missing from Titan's own
# history. Filing is best effort: a failure there is recorded on the
# recipient (saved_to_sent=False) but never counts as a failed send, since
# the recipient did get the message.
#
# smtplib/imaplib are blocking, so every network call runs in a worker
# thread via asyncio.to_thread and the event loop stays free for other
# requests while a bulk send is going out.
import asyncio
import imaplib
import logging
import re
import smtplib
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from app.core.config import settings
from app.models import (
    ContactType,
    DatabaseContact,
    EmailSend,
    EmailSendStatus,
    LeadStatus,
    OutreachChannel,
    RecipientStatus,
)
from app.services.email_render import build_html_document, fill_body, fill_subject, html_to_text, placeholder_values
from app.services.email_signature import LOGO_CID, LogoImage, Signature

logger = logging.getLogger(__name__)

# Background tasks are only weakly referenced by the event loop; holding
# them here keeps a running send from being garbage collected mid-way.
_running_tasks: set[asyncio.Task] = set()


@dataclass
class OutgoingAttachment:
    filename: str
    content_type: str
    data: bytes


def is_configured() -> bool:
    return bool(settings.smtp_user and settings.smtp_password)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def build_message(
    *,
    to_name: str,
    to_email: str,
    subject: str,
    html_document: str,
    attachments: list[OutgoingAttachment],
    logo: LogoImage | None = None,
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_user))
    message["To"] = formataddr((to_name, to_email))
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=True)
    domain = settings.smtp_user.rpartition("@")[2] or None
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(html_to_text(html_document))
    message.add_alternative(html_document, subtype="html")
    if logo is not None:
        # Embedded next to the HTML (multipart/related) and referenced from
        # it as cid:, so mail clients show it inline rather than as a file
        # and don't need to fetch anything from the internet.
        html_part = message.get_payload()[1]
        maintype, _, subtype = logo.content_type.partition("/")
        html_part.add_related(logo.data, maintype=maintype or "image", subtype=subtype or "png", cid=f"<{LOGO_CID}>")
    for attachment in attachments:
        maintype, _, subtype = attachment.content_type.partition("/")
        if not maintype or not subtype:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(attachment.data, maintype=maintype, subtype=subtype, filename=attachment.filename)
    return message


# One line of an IMAP LIST reply: `(\HasNoChildren \Sent) "/" "Sent Items"`.
_LIST_LINE = re.compile(r'^\((?P<flags>[^)]*)\)\s+(?:"[^"]*"|NIL)\s+(?P<name>.+)$')


def sent_folder_from_list_line(line: str) -> str | None:
    """The folder name if this LIST line is the \\Sent folder, else None."""
    match = _LIST_LINE.match(line.strip())
    if match is None or "\\sent" not in match.group("flags").lower().split():
        return None
    name = match.group("name").strip()
    if len(name) >= 2 and name[0] == name[-1] == '"':
        name = name[1:-1].replace('\\"', '"')
    return name


class _Mailbox:
    """One SMTP and one IMAP connection, reused across a whole send.

    Used from worker threads, but only ever one call at a time.
    """

    def __init__(self) -> None:
        self._smtp: smtplib.SMTP_SSL | None = None
        self._imap: imaplib.IMAP4_SSL | None = None
        self._sent_folder: str | None = None

    def _connect_smtp(self) -> smtplib.SMTP_SSL:
        smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ssl.create_default_context(), timeout=30)
        smtp.login(settings.smtp_user, settings.smtp_password)
        return smtp

    def send(self, message: EmailMessage) -> None:
        if self._smtp is None:
            self._smtp = self._connect_smtp()
        try:
            self._smtp.send_message(message)
        except smtplib.SMTPServerDisconnected:
            # Titan drops idle connections; one reconnect covers the pause
            # between messages outlasting its timeout.
            self._smtp = self._connect_smtp()
            self._smtp.send_message(message)

    def _connect_imap(self) -> imaplib.IMAP4_SSL:
        imap = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, ssl_context=ssl.create_default_context(), timeout=30)
        imap.login(settings.smtp_user, settings.smtp_password)
        return imap

    def _find_sent_folder(self, imap: imaplib.IMAP4_SSL) -> str:
        # Prefer the folder the server itself flags as \Sent (RFC 6154), so
        # this still works if Titan names it "Sent Items" or localises it.
        status, folders = imap.list()
        if status == "OK":
            for raw in folders or []:
                line = raw.decode(errors="replace") if isinstance(raw, bytes) else str(raw)
                name = sent_folder_from_list_line(line)
                if name:
                    return name
        return settings.imap_sent_folder

    def save_to_sent(self, message: EmailMessage) -> None:
        if self._imap is None:
            self._imap = self._connect_imap()
            self._sent_folder = self._find_sent_folder(self._imap)
        folder = self._sent_folder or settings.imap_sent_folder
        quoted = f'"{folder}"' if " " in folder else folder
        status, detail = self._imap.append(quoted, "\\Seen", imaplib.Time2Internaldate(time.time()), message.as_bytes())
        if status != "OK":
            raise RuntimeError(f"IMAP APPEND refused: {detail!r}")

    def close(self) -> None:
        for closer in (
            lambda: self._smtp and self._smtp.quit(),
            lambda: self._imap and self._imap.logout(),
        ):
            try:
                closer()
            except Exception:  # noqa: BLE001 — closing is best effort
                pass


def check_connection() -> None:
    """Logs in to SMTP and IMAP without sending anything; raises on failure."""
    mailbox = _Mailbox()
    try:
        mailbox._smtp = mailbox._connect_smtp()
        mailbox._imap = mailbox._connect_imap()
    finally:
        mailbox.close()


def friendly_error(error: Exception) -> str:
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "Titan rejected the login — check SMTP_USER / SMTP_PASSWORD in the backend .env."
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "The recipient's address was refused by the mail server."
    if isinstance(error, smtplib.SMTPDataError) and error.smtp_code in (450, 451, 452, 550, 554):
        detail = error.smtp_error.decode(errors="replace") if isinstance(error.smtp_error, bytes) else str(error.smtp_error)
        return f"The mail server refused the message ({error.smtp_code}): {detail}"
    if isinstance(error, (OSError, smtplib.SMTPException)):
        return f"Couldn't reach the mail server: {error}"
    return str(error) or error.__class__.__name__


async def _mark_contact_emailed(contact_id: int) -> None:
    # A lead that's been emailed is "sent" and has Mail ticked as an
    # outreach channel; clients carry neither. Looked up fresh because the
    # contact may have been edited or deleted since the send started.
    contact = await DatabaseContact.get(contact_id)
    if contact is None or contact.contact_type != ContactType.lead:
        return
    channels = list(contact.outreach_channels or [])
    if OutreachChannel.mail not in channels:
        channels.append(OutreachChannel.mail)
    contact.outreach_channels = channels
    contact.lead_status = LeadStatus.sent
    await contact.save()


async def _run_send(send_id: int, signature: Signature | None, attachments: list[OutgoingAttachment]) -> None:
    send = await EmailSend.get(send_id)
    if send is None:
        return

    mailbox = _Mailbox()
    abort_reason: str | None = None
    try:
        for index, recipient in enumerate(send.recipients):
            if recipient.status != RecipientStatus.pending:
                continue
            if abort_reason is not None:
                recipient.status = RecipientStatus.failed
                recipient.error = abort_reason
                continue

            values = placeholder_values(recipient.name, recipient.contact_person)
            message = build_message(
                to_name=recipient.contact_person or recipient.name,
                to_email=recipient.email,
                subject=fill_subject(send.subject, values),
                html_document=build_html_document(
                    fill_body(send.body_html, values),
                    signature.html if signature else "",
                    signature.inline_logo() if signature else None,
                ),
                attachments=attachments,
                logo=signature.logo if signature else None,
            )
            try:
                await asyncio.to_thread(mailbox.send, message)
            except Exception as error:  # noqa: BLE001 — recorded per recipient
                recipient.status = RecipientStatus.failed
                recipient.error = friendly_error(error)
                # A bad login fails every message the same way; stop rather
                # than hammer Titan with the same rejected credentials.
                if isinstance(error, smtplib.SMTPAuthenticationError):
                    abort_reason = recipient.error
            else:
                recipient.status = RecipientStatus.sent
                recipient.sent_at = _now()
                recipient.message_id = str(message["Message-ID"])
                try:
                    await asyncio.to_thread(mailbox.save_to_sent, message)
                    recipient.saved_to_sent = True
                except Exception:  # noqa: BLE001 — the send itself succeeded
                    logger.exception("email send %s: couldn't file message to the Sent folder", send_id)
                await _mark_contact_emailed(recipient.contact_id)

            send.updated_at = _now()
            await send.save()

            is_last = index == len(send.recipients) - 1
            if not is_last and abort_reason is None:
                await asyncio.sleep(settings.email_send_interval_seconds)
    except Exception:
        logger.exception("email send %s stopped unexpectedly", send_id)
        for recipient in send.recipients:
            if recipient.status == RecipientStatus.pending:
                recipient.status = RecipientStatus.failed
                recipient.error = "Sending stopped unexpectedly — this email was not sent."
    finally:
        await asyncio.to_thread(mailbox.close)
        send.status = EmailSendStatus.done
        send.updated_at = _now()
        await send.save()


def start_send(send_id: int, signature: Signature | None, attachments: list[OutgoingAttachment]) -> None:
    task = asyncio.create_task(_run_send(send_id, signature, attachments))
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)
