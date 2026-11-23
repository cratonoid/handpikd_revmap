# Unit tests for the Inquiries module's rules (app/api/routes/inquiries.py):
# how a status step is built and validated, and that the timeline's latest
# step is the inquiry's current status. Pure helpers, no Mongo, same
# approach as test_accounts.py.
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes import inquiries
from app.models.inquiry import InquiryStatus, InquiryStep
from app.schemas.inquiries import StepFields

_USER = SimpleNamespace(id=3)


def test_a_preset_status_drops_any_custom_label_and_keeps_the_note():
    step = inquiries._build_step(
        StepFields(status=InquiryStatus.options_shared, custom_label="ignored", note="  Sent 3 hamper options  "),
        _USER,
    )
    assert step.custom_label is None
    assert step.note == "Sent 3 hamper options"
    assert step.created_by_user_id == 3
    assert inquiries._step_label(step) == "Options shared"


def test_a_custom_status_shows_its_own_label():
    step = inquiries._build_step(StepFields(status=InquiryStatus.custom, custom_label="Design approved"), None)
    assert inquiries._step_label(step) == "Design approved"
    assert step.note is None
    assert step.created_by_user_id is None


def test_a_custom_status_needs_a_label():
    with pytest.raises(HTTPException) as error:
        inquiries._build_step(StepFields(status=InquiryStatus.custom, custom_label="   "), _USER)
    assert error.value.status_code == 400


def test_details_are_required():
    with pytest.raises(HTTPException):
        inquiries._clean_details("   ")
    assert inquiries._clean_details("  50 Diwali hampers  ") == "50 Diwali hampers"


def test_the_latest_step_is_the_current_status(monkeypatch):
    class _Query:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self):
            return self.rows

    class _Field:
        def __init__(self, name):
            self.name = name

    class _Contacts:
        id = _Field("id")

        @staticmethod
        def find(*_args):
            return _Query([SimpleNamespace(id=10, name="Acme Corp")])

    class _Users:
        id = _Field("id")

        @staticmethod
        def find(*_args):
            return _Query([SimpleNamespace(id=3, name="", mail="riya@example.com")])

    monkeypatch.setattr(inquiries, "DatabaseContact", _Contacts)
    monkeypatch.setattr(inquiries, "User", _Users)
    monkeypatch.setattr(inquiries, "In", lambda field, values: ("in", field.name, values))

    at = datetime(2026, 11, 23, 9, 0)
    inquiry = SimpleNamespace(
        id=1,
        contact_id=10,
        details="50 Diwali hampers",
        assigned_user_id=3,
        steps=[
            InquiryStep(status=InquiryStatus.requirements_received, created_at=at, created_by_user_id=3),
            InquiryStep(status=InquiryStatus.custom, custom_label="Design approved", created_at=at),
        ],
        created_at=at,
        updated_at=at,
    )

    (item,) = asyncio.run(inquiries._to_items([inquiry]))

    assert item.lead_name == "Acme Corp"
    # A user with no name is shown by their email.
    assert item.assigned_user_name == "riya@example.com"
    assert item.current_status == InquiryStatus.custom
    assert item.current_status_label == "Design approved"
    assert [step.label for step in item.steps] == ["Requirements received", "Design approved"]
    assert item.steps[0].created_by_name == "riya@example.com"


def test_assigning_to_yourself_sends_no_notification(monkeypatch):
    sent = []

    async def fake_notify(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(inquiries, "notify", fake_notify)
    inquiry = SimpleNamespace(id=1, assigned_user_id=3, details="x")

    asyncio.run(inquiries._notify_assignee(inquiry, "Acme", SimpleNamespace(id=3)))
    assert sent == []

    asyncio.run(inquiries._notify_assignee(inquiry, "Acme", SimpleNamespace(id=4)))
    assert sent[0]["recipient_user_id"] == 3
    assert sent[0]["link"] == "/admin/inquiries?inquiry=1"
