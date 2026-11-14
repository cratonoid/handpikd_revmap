# Unit tests for the holiday calendar (app/api/routes/information.py and
# _seed_holiday_events in app/core/db.py):
#
#   - the defaults are seeded once, and never again once the counter exists
#     (so deleting every entry doesn't bring them back),
#   - a new entry goes to the end of its month, and so does an entry moved
#     to another month,
#   - blank names are rejected.
#
# HolidayEvent is stubbed rather than queried, same approach as
# test_tickets.py: real Beanie queries need a live Mongo.
import asyncio

import pytest
from pydantic import ValidationError

from app.api.routes import information
from app.core import db
from app.schemas.information import AddHolidayEventRequest, UpdateHolidayEventRequest


class _StubEvent:
    def __init__(self, **fields) -> None:
        self.__dict__.update(fields)
        self.saved = 0

    async def save(self) -> None:
        self.saved += 1


def test_blank_name_is_rejected():
    with pytest.raises(ValidationError):
        AddHolidayEventRequest(month=1, name="   ")
    with pytest.raises(ValidationError):
        AddHolidayEventRequest(month=13, name="Diwali")


@pytest.fixture
def route_state(monkeypatch):
    state: dict = {"events": {}, "inserted": []}

    async def _next_sort_order(month: int) -> int:
        orders = [e.sort_order for e in state["events"].values() if e.month == month]
        return max(orders) + 1 if orders else 0

    async def _get_or_404(event_id: int):
        return state["events"][event_id]

    async def _next_id(*_args):
        return 99

    class _Model:
        def __init__(self, **fields) -> None:
            self.__dict__.update(fields)

        async def insert(self) -> None:
            state["inserted"].append(self)

    monkeypatch.setattr(information, "_next_sort_order", _next_sort_order)
    monkeypatch.setattr(information, "_get_or_404", _get_or_404)
    monkeypatch.setattr(information, "get_next_id", _next_id)
    monkeypatch.setattr(information, "HolidayEvent", _Model)
    return state


def test_new_entry_goes_to_end_of_its_month(route_state):
    route_state["events"][1] = _StubEvent(id=1, month=10, name="Dussehra", when="", note="", sort_order=3)
    item = asyncio.run(
        information.add_holiday_event(AddHolidayEventRequest(month=10, name=" Navratri ", when="varies"), None)
    )
    assert (item.id, item.month, item.name, item.sort_order) == (99, 10, "Navratri", 4)
    assert len(route_state["inserted"]) == 1


def test_moving_month_reorders_but_editing_in_place_does_not(route_state):
    event = _StubEvent(id=1, month=3, name="Holi", when="", note="", sort_order=0)
    route_state["events"][1] = event
    route_state["events"][2] = _StubEvent(id=2, month=4, name="Easter", when="", note="", sort_order=5)

    asyncio.run(information.update_holiday_event(UpdateHolidayEventRequest(id=1, month=3, name="Holi", when="varies"), None))
    assert event.sort_order == 0 and event.when == "varies"

    asyncio.run(information.update_holiday_event(UpdateHolidayEventRequest(id=1, month=4, name="Holi"), None))
    assert (event.month, event.sort_order) == (4, 6)
    assert event.saved == 2


@pytest.fixture
def seed_state(monkeypatch):
    state: dict = {"counter": None, "existing": 0, "inserted": []}

    class _Counters:
        async def find_one(self, _query):
            return state["counter"]

        async def insert_one(self, doc):
            state["counter"] = doc

    class _CounterModel:
        @staticmethod
        def get_pymongo_collection():
            return _Counters()

    class _Query:
        async def count(self):
            return state["existing"]

    class _EventModel:
        def __init__(self, **fields) -> None:
            self.fields = fields

        @staticmethod
        def find_all():
            return _Query()

        async def insert(self) -> None:
            state["inserted"].append(self.fields)

    monkeypatch.setattr(db, "HolidayEventIdCounter", _CounterModel)
    monkeypatch.setattr(db, "HolidayEvent", _EventModel)
    return state


def test_seeds_defaults_on_a_fresh_database(seed_state):
    asyncio.run(db._seed_holiday_events())
    inserted = seed_state["inserted"]
    assert len(inserted) == len(db._HOLIDAY_EVENT_SEED)
    assert [e["id"] for e in inserted] == list(range(1, len(inserted) + 1))
    january = [e for e in inserted if e["month"] == 1]
    assert [e["sort_order"] for e in january] == list(range(len(january)))
    assert seed_state["counter"] == {"_id": 1, "next_holiday_event_id": len(inserted)}


def test_does_not_reseed_once_the_counter_exists(seed_state):
    seed_state["counter"] = {"_id": 1, "next_holiday_event_id": 29}
    asyncio.run(db._seed_holiday_events())
    assert seed_state["inserted"] == []
