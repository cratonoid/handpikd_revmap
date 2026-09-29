# Tests for the background send loop in app/services/email_sender.py, with
# the mailbox and the Mongo documents replaced by fakes — no SMTP, IMAP or
# database connection, and nothing is actually emailed.
import asyncio
import smtplib
from types import SimpleNamespace

import pytest

from app.models import ContactType, EmailRecipient, EmailSendStatus, LeadStatus, OutreachChannel, RecipientStatus
from app.services import email_sender


class FakeMailbox:
    def __init__(self, fail_for: dict[str, Exception] | None = None, filing_fails: bool = False):
        self.fail_for = fail_for or {}
        self.filing_fails = filing_fails
        self.sent: list = []
        self.filed: list = []
        self.closed = False

    def send(self, message):
        to = message["To"]
        for address, error in self.fail_for.items():
            if address in to:
                raise error
        self.sent.append(message)

    def save_to_sent(self, message):
        if self.filing_fails:
            raise RuntimeError("IMAP down")
        self.filed.append(message)

    def close(self):
        self.closed = True


def _make_send(recipients):
    async def save():
        return None

    return SimpleNamespace(
        id=7,
        subject="Hello {{contact_person}}",
        body_html="<p>Hi {{contact_person}} at {{name}}</p>",
        recipients=recipients,
        status=EmailSendStatus.sending,
        updated_at=None,
        save=save,
    )


def _make_contact(contact_type, channels=None):
    async def save():
        return None

    return SimpleNamespace(
        contact_type=contact_type,
        outreach_channels=list(channels or []),
        lead_status=LeadStatus.new,
        save=save,
    )


@pytest.fixture
def wire(monkeypatch):
    def _wire(send, mailbox, contacts):
        async def get_send(_id):
            return send

        async def get_contact(contact_id):
            return contacts.get(contact_id)

        monkeypatch.setattr(email_sender.EmailSend, "get", get_send)
        monkeypatch.setattr(email_sender.DatabaseContact, "get", get_contact)
        monkeypatch.setattr(email_sender, "_Mailbox", lambda: mailbox)
        monkeypatch.setattr(email_sender.settings, "email_send_interval_seconds", 0)
        monkeypatch.setattr(email_sender.settings, "smtp_user", "info@handpikd.co")

    return _wire


def test_each_recipient_gets_own_personalised_message(wire):
    send = _make_send(
        [
            EmailRecipient(contact_id=1, name="Acme", email="a@acme.co", contact_person="Riya"),
            EmailRecipient(contact_id=2, name="Beta Ltd", email="b@beta.co"),
        ]
    )
    mailbox = FakeMailbox()
    lead = _make_contact(ContactType.lead, [OutreachChannel.whatsapp])
    wire(send, mailbox, {1: lead, 2: _make_contact(ContactType.lead)})

    asyncio.run(email_sender._run_send(7, "<b>Alvis</b>", []))

    assert [message["Subject"] for message in mailbox.sent] == ["Hello Riya", "Hello Beta Ltd"]
    assert "Hi Riya at Acme" in mailbox.sent[0].get_body(("html",)).get_content()
    assert "<b>Alvis</b>" in mailbox.sent[0].get_body(("html",)).get_content()
    assert len(mailbox.filed) == 2
    assert all(recipient.status == RecipientStatus.sent and recipient.saved_to_sent for recipient in send.recipients)
    assert send.status == EmailSendStatus.done
    assert mailbox.closed
    # Emailing a lead marks it sent and ticks Mail, keeping WhatsApp.
    assert lead.lead_status == LeadStatus.sent
    assert lead.outreach_channels == [OutreachChannel.whatsapp, OutreachChannel.mail]


def test_one_refused_recipient_does_not_stop_the_rest(wire):
    send = _make_send(
        [
            EmailRecipient(contact_id=1, name="Bad", email="bad@x.co"),
            EmailRecipient(contact_id=2, name="Good", email="good@x.co"),
        ]
    )
    refused = smtplib.SMTPRecipientsRefused({"bad@x.co": (550, b"no such user")})
    mailbox = FakeMailbox(fail_for={"bad@x.co": refused}, filing_fails=True)
    client = _make_contact(ContactType.client)
    wire(send, mailbox, {1: _make_contact(ContactType.client), 2: client})

    asyncio.run(email_sender._run_send(7, "", []))

    bad, good = send.recipients
    assert bad.status == RecipientStatus.failed and "refused" in bad.error
    assert good.status == RecipientStatus.sent
    # Delivered but not filed: still a success, flagged separately.
    assert good.saved_to_sent is False
    # Clients carry no outreach or lead status.
    assert client.outreach_channels == [] and client.lead_status == LeadStatus.new


def test_bad_login_fails_everyone_without_retrying(wire):
    send = _make_send(
        [EmailRecipient(contact_id=index, name=f"C{index}", email=f"c{index}@x.co") for index in range(1, 4)]
    )
    auth_error = smtplib.SMTPAuthenticationError(535, b"bad credentials")
    mailbox = FakeMailbox(fail_for={"@x.co": auth_error})
    wire(send, mailbox, {})

    asyncio.run(email_sender._run_send(7, "", []))

    assert all(recipient.status == RecipientStatus.failed for recipient in send.recipients)
    assert all("SMTP_PASSWORD" in recipient.error for recipient in send.recipients)
    assert send.status == EmailSendStatus.done
