# Tests for bounce detection (app/services/email_bounces.py): parsing real-
# shaped bounce reports, and matching them to what the app sent. Mongo is
# replaced with fakes; no IMAP connection is made.
import asyncio
from datetime import datetime
from types import SimpleNamespace

from app.models import EmailRecipient, RecipientStatus
from app.services import email_bounces
from app.services.email_bounces import Bounce, parse_bounce

OUR_ID = "<172751.123.abc@handpikd.co>"


def _dsn(action="failed", status="5.1.1", diagnostic="smtp; 550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown", message_id=OUR_ID):
    # Shaped like the RFC 3464 report Titan's (Postfix-style) MTA returns.
    return (
        "From: MAILER-DAEMON@mx.titan.email (Mail Delivery System)\r\n"
        "To: info@handpikd.co\r\n"
        "Subject: Undelivered Mail Returned to Sender\r\n"
        "Date: Tue, 29 Sep 2026 12:10:00 +0000\r\n"
        "MIME-Version: 1.0\r\n"
        'Content-Type: multipart/report; report-type=delivery-status; boundary="B"\r\n'
        "\r\n"
        "--B\r\n"
        "Content-Type: text/plain\r\n\r\n"
        "This is the mail system. I'm sorry to have to inform you that your message could not be delivered.\r\n"
        "--B\r\n"
        "Content-Type: message/delivery-status\r\n\r\n"
        "Reporting-MTA: dns; mx.titan.email\r\n"
        "\r\n"
        "Final-Recipient: rfc822; nobody@example.com\r\n"
        f"Action: {action}\r\n"
        f"Status: {status}\r\n"
        f"Diagnostic-Code: {diagnostic}\r\n"
        "--B\r\n"
        "Content-Type: text/rfc822-headers\r\n\r\n"
        "From: Handpikd <info@handpikd.co>\r\n"
        "To: nobody@example.com\r\n"
        "Subject: Diwali hampers\r\n"
        f"Message-ID: {message_id}\r\n"
        "--B--\r\n"
    ).encode()


def test_permanent_failure_is_parsed_with_reason_and_original_id():
    [bounce] = parse_bounce(_dsn())
    assert bounce.recipient == "nobody@example.com"
    assert bounce.original_message_id == OUR_ID
    assert bounce.reason.startswith("The email address doesn't exist.")
    assert "User unknown" in bounce.reason
    assert bounce.received_at == datetime(2026, 9, 29, 12, 10)


def test_delay_warnings_are_ignored():
    assert parse_bounce(_dsn(action="delayed", status="4.4.1")) == []


def test_ordinary_mail_is_not_a_bounce():
    raw = b"From: Riya <riya@acme.co>\r\nSubject: Re: hampers\r\nContent-Type: text/plain\r\n\r\nSounds good\r\n"
    assert parse_bounce(raw) == []


def test_plain_text_report_falls_back_to_addresses():
    raw = (
        "From: Mail Delivery Subsystem <mailer-daemon@example.net>\r\n"
        "Subject: Delivery Status Notification (Failure)\r\n"
        "Content-Type: text/plain\r\n\r\n"
        "Your message to gone@example.net couldn't be delivered.\r\n"
        "It was sent by info@handpikd.co.\r\n"
    ).encode()
    bounces = parse_bounce(raw)
    # Our own address in the text isn't mistaken for the failed one.
    assert [bounce.recipient for bounce in bounces] == ["gone@example.net"]


def _wire(monkeypatch, recipients):
    saved = []

    async def save():
        saved.append(True)

    send = SimpleNamespace(id=1, recipients=recipients, save=save)

    class FakeQuery:
        async def to_list(self):
            return [send]

    contact = SimpleNamespace(email="nobody@example.com", email_bounced_at=None, email_bounce_reason=None)

    async def save_contact():
        return None

    contact.save = save_contact

    async def get_contact(_id):
        return contact

    monkeypatch.setattr(email_bounces.EmailSend, "find", lambda *args, **kwargs: FakeQuery())
    monkeypatch.setattr(email_bounces.DatabaseContact, "get", get_contact)
    return send, contact, saved


def _recipient(**overrides):
    fields = dict(
        contact_id=5,
        name="Nobody Ltd",
        email="nobody@example.com",
        status=RecipientStatus.sent,
        sent_at=datetime(2026, 9, 29, 12, 0),
        message_id=OUR_ID,
    )
    fields.update(overrides)
    return EmailRecipient(**fields)


def test_bounce_marks_recipient_and_flags_contact(monkeypatch):
    send, contact, saved = _wire(monkeypatch, [_recipient()])

    found = asyncio.run(email_bounces.apply_bounces(parse_bounce(_dsn())))

    assert found == 1 and saved
    assert send.recipients[0].status == RecipientStatus.bounced
    assert "doesn't exist" in send.recipients[0].bounce_reason
    assert contact.email_bounced_at is not None
    # Applying the same report again changes nothing.
    assert asyncio.run(email_bounces.apply_bounces(parse_bounce(_dsn()))) == 0


def test_bounce_for_mail_sent_outside_the_app_is_not_matched(monkeypatch):
    send, contact, _ = _wire(monkeypatch, [_recipient()])

    found = asyncio.run(email_bounces.apply_bounces(parse_bounce(_dsn(message_id="<manual@titan.email>"))))

    assert found == 0
    assert send.recipients[0].status == RecipientStatus.sent
    assert contact.email_bounced_at is None


def test_report_without_message_id_matches_by_address(monkeypatch):
    send, _, _ = _wire(monkeypatch, [_recipient()])
    bounce = Bounce("nobody@example.com", "Delivery failed.", None, datetime(2026, 9, 29, 13, 0))

    assert asyncio.run(email_bounces.apply_bounces([bounce])) == 1
    assert send.recipients[0].status == RecipientStatus.bounced


def test_contact_with_corrected_address_is_not_flagged(monkeypatch):
    _, contact, _ = _wire(monkeypatch, [_recipient()])
    contact.email = "fixed@example.com"

    asyncio.run(email_bounces.apply_bounces(parse_bounce(_dsn())))

    assert contact.email_bounced_at is None
