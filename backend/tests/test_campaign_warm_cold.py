# Unit tests for Warm / Cold inside a campaign (warm_contact_ids_in in
# services/campaign_leads.py) and the campaign date check in
# routes/campaigns.py. A lead is Warm in a campaign when an EARLIER campaign
# already reached it (fully sent), and Cold when this campaign is the first.
#
# Beanie is stubbed out, as in test_purchase_order_duplicate_guard.py.
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes import campaigns as campaign_routes
from app.services import campaign_leads


class _Cursor:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def __aiter__(self):
        async def gen():
            for row in self.rows:
                yield row

        return gen()


def _campaign(campaign_id: int, created: datetime, start: datetime | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=campaign_id, created_at=created, start_date=start, end_date=None)


@pytest.fixture
def world(monkeypatch):
    state = SimpleNamespace(campaigns=[], contacts=[], rows=[], queries=[])

    class _Query:
        async def to_list(self):
            return state.campaigns

    class _Campaigns:
        @staticmethod
        def find_all():
            return _Query()

    class _Collection:
        def __init__(self, rows_attr: str) -> None:
            self.rows_attr = rows_attr

        def find(self, query, _projection):
            state.queries.append(query)
            rows = getattr(state, self.rows_attr)
            if "campaign_id" in query:
                rows = [row for row in rows if row["campaign_id"] in query["campaign_id"]["$in"]]
            if "source" in query:
                rows = [row for row in rows if row.get("source") not in query["source"]["$nin"]]
            return _Cursor(rows)

    class _Contacts:
        @staticmethod
        def get_pymongo_collection():
            return _Collection("contacts")

    class _Leads:
        @staticmethod
        def get_pymongo_collection():
            return _Collection("rows")

    monkeypatch.setattr(campaign_leads, "Campaign", _Campaigns)
    monkeypatch.setattr(campaign_leads, "DatabaseContact", _Contacts)
    monkeypatch.setattr(campaign_leads, "CampaignLead", _Leads)
    return state


def test_only_leads_reached_in_an_earlier_campaign_are_warm(world):
    diwali = _campaign(1, datetime(2026, 10, 1))
    christmas = _campaign(2, datetime(2026, 11, 20))
    world.campaigns = [diwali, christmas]
    world.contacts = [
        {"_id": 10, "outreach_channels": ["mail"]},
        {"_id": 11, "outreach_channels": ["mail", "whatsapp"]},
        {"_id": 12, "outreach_channels": ["mail"]},
    ]
    world.rows = [
        {"campaign_id": 1, "contact_id": 10, "sent_channels": ["mail"]},  # reached in Diwali
        {"campaign_id": 1, "contact_id": 11, "sent_channels": ["mail"]},  # only half reached
        {"campaign_id": 2, "contact_id": 12, "sent_channels": ["mail"]},  # first reached at Christmas
    ]

    assert asyncio.run(campaign_leads.warm_contact_ids_in(christmas)) == {10}
    # Nothing came before Diwali, so every lead is Cold there.
    assert asyncio.run(campaign_leads.warm_contact_ids_in(diwali)) == set()


def test_a_lead_from_anywhere_but_a_cold_call_is_warm_in_every_campaign(world):
    diwali = _campaign(1, datetime(2026, 10, 1))
    world.campaigns = [diwali]
    world.contacts = [
        {"_id": 20, "outreach_channels": ["mail"], "source": "referral"},
        {"_id": 21, "outreach_channels": ["mail"], "source": "cold_call"},
        {"_id": 22, "outreach_channels": ["mail"]},
    ]

    # Even in the first campaign, with nothing sent yet.
    assert asyncio.run(campaign_leads.warm_contact_ids_in(diwali)) == {20}


def test_start_date_orders_campaigns_ahead_of_created_at(world):
    # Created later, but set to start earlier: it counts as the earlier one.
    backfilled = _campaign(2, datetime(2026, 11, 20), start=datetime(2026, 9, 1))
    current = _campaign(1, datetime(2026, 10, 1))
    world.campaigns = [backfilled, current]
    world.contacts = [{"_id": 10, "outreach_channels": ["mail"]}]
    world.rows = [{"campaign_id": 2, "contact_id": 10, "sent_channels": ["mail"]}]

    assert asyncio.run(campaign_leads.warm_contact_ids_in(current)) == {10}
    assert asyncio.run(campaign_leads.warm_contact_ids_in(backfilled)) == set()


def test_end_date_before_start_date_is_refused():
    campaign = SimpleNamespace(start_date=datetime(2026, 12, 1), end_date=datetime(2026, 11, 1))
    with pytest.raises(HTTPException) as error:
        campaign_routes._check_dates(campaign)
    assert error.value.status_code == 400


def test_open_ended_and_ordered_dates_pass():
    campaign_routes._check_dates(SimpleNamespace(start_date=datetime(2026, 12, 1), end_date=None))
    campaign_routes._check_dates(
        SimpleNamespace(start_date=datetime(2026, 12, 1), end_date=datetime(2026, 12, 31))
    )
