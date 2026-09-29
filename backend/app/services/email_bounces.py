# Finds emails that bounced after Titan accepted them.
#
# A send only fails on the spot when Titan itself refuses it (see
# services/email_sender.py). Most real delivery failures — a mailbox that
# doesn't exist, one that's full, a server that rejects the message — happen
# minutes later at the recipient's end, and come back as a bounce report
# ("Undelivered Mail Returned to Sender") in the Titan inbox. This module
# reads those reports over IMAP and marks the matching recipient "bounced".
#
# Matching is by the Message-ID each recipient's copy was sent with, which
# standard bounce reports (RFC 3464 multipart/report) quote back in the
# original message's headers — so a bounce is pinned to exactly one send.
# Only when a report doesn't quote it does matching fall back to the
# address, taking the latest delivered send to it before the bounce.
#
# The inbox is opened read-only: reports stay unread and exactly where they
# were, so the mailbox looks the same in Titan afterwards. Applying a report
# twice is a no-op, so every check simply re-reads the last few weeks.
import asyncio
import email
import imaplib
import logging
import re
import ssl
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email import policy
from email.message import Message
from email.parser import HeaderParser
from email.utils import parseaddr, parsedate_to_datetime

from app.core.config import settings
from app.models import DatabaseContact, EmailSend, EmailSendStatus, RecipientStatus
from app.services import email_sender

logger = logging.getLogger(__name__)

# How far back to look for bounce reports, and for the sends they belong to.
# Bounces come back within minutes to a couple of days; a report older than
# this has long since been applied.
_REPORT_WINDOW = timedelta(days=14)
_SEND_WINDOW = timedelta(days=30)
_MAX_REPORTS_PER_CHECK = 300
CHECK_INTERVAL_SECONDS = 10 * 60

_MESSAGE_ID = re.compile(r"<[^<>\s@]+@[^<>\s]+>")
_ADDRESS = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_BOUNCE_SUBJECT = re.compile(
    r"undeliver|undelivered|delivery status notification|delivery failure|failure notice|returned mail|"
    r"mail delivery failed|could not be delivered",
    re.IGNORECASE,
)
_BOUNCE_SENDER = re.compile(r"mailer-daemon|postmaster|mail delivery", re.IGNORECASE)

# Plain-English wording for the enhanced status codes admins actually meet.
_STATUS_REASONS = {
    "5.1.1": "The email address doesn't exist.",
    "5.1.2": "The recipient's domain doesn't exist.",
    "5.1.10": "The email address doesn't exist.",
    "5.2.1": "The mailbox is disabled.",
    "5.2.2": "The recipient's mailbox is full.",
    "5.3.4": "The email was too large for the recipient's server.",
    "5.4.1": "The recipient's server refused the email.",
    "5.7.1": "The recipient's server blocked the email as spam or policy.",
    "5.7.26": "The recipient's server rejected the email (sender authentication).",
}


@dataclass
class Bounce:
    # Lower-cased address that couldn't be delivered to.
    recipient: str
    reason: str
    # Message-ID of our original email, when the report quotes it.
    original_message_id: str | None
    received_at: datetime | None


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clean_address(value: str | None) -> str | None:
    if not value:
        return None
    # Final-Recipient: rfc822; someone@example.com
    value = value.split(";", 1)[-1].strip()
    match = _ADDRESS.search(value)
    return match.group(0).lower() if match else None


def _reason(status: str | None, diagnostic: str | None) -> str:
    code = (status or "").strip()
    friendly = _STATUS_REASONS.get(code)
    detail = ""
    if diagnostic:
        # "smtp; 550 5.1.1 <x@y>: Recipient address rejected" → keep the
        # server's own words, minus the type prefix, as the detail.
        detail = " ".join(diagnostic.split(";", 1)[-1].split())[:300]
    if friendly and detail:
        return f"{friendly} ({detail})"
    if friendly:
        return friendly
    if detail:
        return detail
    return f"Delivery failed (status {code})." if code else "Delivery failed."


def _received_at(message: Message) -> datetime | None:
    try:
        parsed = parsedate_to_datetime(message["Date"])
    except (TypeError, ValueError, IndexError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _original_message_id(message: Message) -> str | None:
    for part in message.walk():
        content_type = part.get_content_type()
        if content_type == "text/rfc822-headers":
            headers = HeaderParser().parsestr(part.get_payload(decode=True).decode(errors="replace"))
            if headers.get("Message-ID"):
                return headers["Message-ID"].strip()
        elif content_type in ("message/rfc822", "message/global") and part.is_multipart():
            inner = part.get_payload(0)
            if inner.get("Message-ID"):
                return str(inner["Message-ID"]).strip()
    return None


def _looks_like_bounce(message: Message) -> bool:
    if message.get_content_type() == "multipart/report":
        return True
    sender = parseaddr(str(message.get("From", "")))
    return bool(
        _BOUNCE_SENDER.search(" ".join(sender)) and _BOUNCE_SUBJECT.search(str(message.get("Subject", "")))
    )


def parse_bounce(raw: bytes) -> list[Bounce]:
    """The permanent delivery failures one bounce report describes.

    Delay warnings ("still trying") and successful-delivery reports carry
    Action: delayed / delivered and are ignored.
    """
    message = email.message_from_bytes(raw, policy=policy.compat32)
    if not _looks_like_bounce(message):
        return []

    received_at = _received_at(message)
    original_id = _original_message_id(message)
    bounces: list[Bounce] = []
    has_status_part = False

    for part in message.walk():
        if part.get_content_type() != "message/delivery-status":
            continue
        has_status_part = True
        # The delivery-status body is a series of header blocks: one about
        # the reporting server, then one per recipient.
        blocks = part.get_payload() if part.is_multipart() else []
        if not blocks:
            text = part.get_payload(decode=True) or b""
            blocks = [HeaderParser().parsestr(chunk) for chunk in text.decode(errors="replace").split("\n\n")]
        for block in blocks:
            recipient = _clean_address(block.get("Final-Recipient") or block.get("Original-Recipient"))
            if recipient is None:
                continue
            action = (block.get("Action") or "").strip().lower()
            status = (block.get("Status") or "").strip()
            if action != "failed" and not status.startswith("5"):
                continue
            bounces.append(Bounce(recipient, _reason(status, block.get("Diagnostic-Code")), original_id, received_at))

    # A structured report is authoritative: if it lists no permanent
    # failures (a delay warning, say), there are none — the text fallback
    # below would misread the addresses it mentions as bounced.
    if has_status_part:
        return bounces

    # Non-standard reports (plain text, no delivery-status part): fall back
    # to the addresses and Message-ID quoted in the text. Our own address
    # appears there too, so it's excluded.
    text_parts = []
    for part in message.walk():
        if part.get_content_maintype() == "text":
            payload = part.get_payload(decode=True) or b""
            text_parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    text = "\n".join(text_parts)
    own = (settings.smtp_user or "").lower()
    quoted_id = original_id
    if quoted_id is None:
        header_match = re.search(r"^Message-ID:\s*(<[^>]+>)", text, re.IGNORECASE | re.MULTILINE)
        quoted_id = header_match.group(1) if header_match else None
    addresses = []
    for match in _ADDRESS.finditer(text):
        address = match.group(0).lower()
        if address != own and "mailer-daemon" not in address and "postmaster" not in address and address not in addresses:
            addresses.append(address)
    return [Bounce(address, "Delivery failed.", quoted_id, received_at) for address in addresses]


def _fetch_recent_reports() -> list[bytes]:
    """Raw bounce reports from the inbox's last _REPORT_WINDOW, read-only."""
    imap = imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, ssl_context=ssl.create_default_context(), timeout=30)
    try:
        imap.login(settings.smtp_user, settings.smtp_password)
        # readonly: EXAMINE rather than SELECT, so nothing is marked read.
        imap.select("INBOX", readonly=True)
        since = (_now() - _REPORT_WINDOW).strftime("%d-%b-%Y")
        uids: set[bytes] = set()
        for criteria in (
            f'(SINCE {since} FROM "mailer-daemon")',
            f'(SINCE {since} FROM "postmaster")',
            f'(SINCE {since} HEADER Content-Type "multipart/report")',
        ):
            status, data = imap.uid("SEARCH", None, criteria)
            if status == "OK" and data and data[0]:
                uids.update(data[0].split())
        reports: list[bytes] = []
        for uid in sorted(uids, key=int, reverse=True)[:_MAX_REPORTS_PER_CHECK]:
            status, data = imap.uid("FETCH", uid, "(BODY.PEEK[])")
            if status != "OK":
                continue
            for item in data or []:
                if isinstance(item, tuple) and len(item) == 2:
                    reports.append(item[1])
        return reports
    finally:
        try:
            imap.logout()
        except Exception:  # noqa: BLE001 — closing is best effort
            pass


async def apply_bounces(bounces: list[Bounce]) -> int:
    """Marks the matching delivered recipients bounced; returns how many changed."""
    if not bounces:
        return 0
    # Only finished sends: a running one is saved whole after every message
    # by the send loop, which would overwrite a change made here.
    sends = await EmailSend.find(
        {
            "created_at": {"$gte": _now() - _SEND_WINDOW},
            "status": EmailSendStatus.done.value,
            "recipients.status": RecipientStatus.sent.value,
        }
    ).to_list()

    by_message_id: dict[str, tuple] = {}
    by_address: dict[str, list[tuple]] = {}
    for send in sends:
        for recipient in send.recipients:
            if recipient.message_id:
                by_message_id[recipient.message_id.strip()] = (send, recipient)
            by_address.setdefault(recipient.email.lower(), []).append((send, recipient))

    changed_sends: dict[int, EmailSend] = {}
    bounced_contacts: dict[int, tuple[str, str]] = {}
    count = 0
    for bounce in bounces:
        if bounce.original_message_id:
            # The report says exactly which email bounced. If it isn't one
            # the app sent (mail sent straight from Titan, say), it's not
            # ours to mark — even if the address matches one of our sends.
            match = by_message_id.get(bounce.original_message_id.strip())
        else:
            candidates = [
                (send, recipient)
                for send, recipient in by_address.get(bounce.recipient, [])
                if recipient.sent_at is not None and (bounce.received_at is None or recipient.sent_at <= bounce.received_at)
            ]
            match = max(candidates, key=lambda pair: pair[1].sent_at) if candidates else None
        if match is None:
            continue
        send, recipient = match
        if recipient.status != RecipientStatus.sent:
            continue
        recipient.status = RecipientStatus.bounced
        recipient.bounce_reason = bounce.reason
        recipient.bounced_at = bounce.received_at or _now()
        changed_sends[send.id] = send
        bounced_contacts[recipient.contact_id] = (recipient.email.lower(), bounce.reason)
        count += 1

    for send in changed_sends.values():
        await send.save()
    for contact_id, (address, reason) in bounced_contacts.items():
        contact = await DatabaseContact.get(contact_id)
        # Only while the contact still has the address that bounced — if it's
        # been corrected since, the new one hasn't failed.
        if contact is not None and (contact.email or "").lower() == address:
            contact.email_bounced_at = _now()
            contact.email_bounce_reason = reason
            await contact.save()
    return count


async def check_bounces() -> int:
    """Reads the inbox for new bounce reports and applies them; returns how many recipients bounced."""
    if not email_sender.is_configured():
        return 0
    reports = await asyncio.to_thread(_fetch_recent_reports)
    bounces = [bounce for raw in reports for bounce in parse_bounce(raw)]
    return await apply_bounces(bounces)


async def bounce_check_loop() -> None:
    # Started from app/main.py's lifespan. A failed check (Titan briefly
    # unreachable) is logged and retried next round, never fatal.
    await asyncio.sleep(60)
    while True:
        try:
            found = await check_bounces()
            if found:
                logger.info("bounce check: marked %s recipient(s) bounced", found)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("bounce check failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
