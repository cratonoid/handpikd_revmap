# Unit tests for contact_statuses in app/api/routes/campaigns.py: how a
# campaign's sends add up to each contact's standing. Pure, so no Mongo
# connection is needed.
from datetime import datetime

from app.api.routes.campaigns import contact_statuses
from app.models import EmailAudience, EmailSendStatus, RecipientStatus
from app.schemas.emails import EmailRecipientItem, EmailSendItem


def _send(send_id: int, *recipients: tuple[int, RecipientStatus], template: str = "Intro") -> EmailSendItem:
    items = [
        EmailRecipientItem(
            contact_id=contact_id,
            name=f"Contact {contact_id}",
            email=f"c{contact_id}@example.com",
            status=recipient_status,
            error="refused" if recipient_status == RecipientStatus.failed else None,
            saved_to_sent=recipient_status == RecipientStatus.sent,
            sent_at=datetime(2026, 10, send_id) if recipient_status == RecipientStatus.sent else None,
        )
        for contact_id, recipient_status in recipients
    ]
    return EmailSendItem(
        send_id=send_id,
        audience=EmailAudience.lead,
        template_id=1,
        template_name=template,
        subject="Hello",
        body_html="<p>Hi</p>",
        attachment_names=[],
        status=EmailSendStatus.done,
        interrupted=False,
        total=len(items),
        sent_count=0,
        failed_count=0,
        bounced_count=0,
        recipients=items,
        created_at=datetime(2026, 10, send_id),
    )


def test_contacts_never_emailed_have_no_entry():
    assert contact_statuses([]) == {}
    assert set(contact_statuses([_send(1, (7, RecipientStatus.sent))])) == {7}


def test_a_retry_that_succeeds_replaces_the_failure():
    result = contact_statuses([_send(1, (7, RecipientStatus.failed)), _send(2, (7, RecipientStatus.sent), template="Follow-up")])
    assert result[7].status == RecipientStatus.sent
    assert result[7].template_name == "Follow-up"
    assert result[7].attempts == 2
    assert result[7].error is None


def test_a_later_failure_does_not_hide_an_earlier_delivery():
    result = contact_statuses([_send(1, (7, RecipientStatus.sent)), _send(2, (7, RecipientStatus.failed))])
    assert result[7].status == RecipientStatus.sent
    assert result[7].sent_at == datetime(2026, 10, 1)
    assert result[7].attempts == 2


def test_order_is_by_send_id_not_list_order():
    # The routes hand sends over newest first.
    result = contact_statuses([_send(2, (7, RecipientStatus.sent)), _send(1, (7, RecipientStatus.failed))])
    assert result[7].status == RecipientStatus.sent
    assert result[7].attempts == 2


def test_a_bounce_on_the_latest_delivery_shows_as_bounced():
    result = contact_statuses([_send(1, (7, RecipientStatus.failed)), _send(2, (7, RecipientStatus.bounced))])
    assert result[7].status == RecipientStatus.bounced
