# Unit tests for app/services/customer_points.py — client loyalty points.
#
# The rules worth pinning down: a lot is worth nothing from its expiry date
# on; the two 5% figures (earned off a paid invoice, spendable on an order)
# round down; spending draws the soonest-expiring points first; an edited
# order hands its old points back before taking new ones; and an invoice
# earns one reward ever, withdrawn and reinstated as it goes unpaid and paid.
#
# #customer_points_lot is replaced by an in-memory store, same no-Mongo
# approach as test_invoice_status_update.py.
import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models import InvoiceStatus, InvoiceType, PointsAllocation, PointsSource
from app.services import customer_points

TODAY = date(2026, 10, 9)


@dataclass
class _Lot:
    id: int
    cust_id: int
    points: int
    expires_at: datetime
    used: int = 0
    is_revoked: bool = False
    source: PointsSource = PointsSource.manual
    invoice_id: int | None = None
    saves: int = 0

    async def save(self) -> None:
        self.saves += 1


class _UpdateResult:
    def __init__(self, modified: bool) -> None:
        self.modified_count = 1 if modified else 0


class _Store:
    """Stands in for #customer_points_lot and its raw pymongo collection."""

    def __init__(self) -> None:
        self.lots: dict[int, _Lot] = {}
        self.granted: list[dict] = []

    def add(self, cust_id: int, points: int, expires_on: date, **fields) -> _Lot:
        lot = _Lot(
            id=len(self.lots) + 1,
            cust_id=cust_id,
            points=points,
            expires_at=datetime.combine(expires_on, datetime.min.time()),
            **fields,
        )
        self.lots[lot.id] = lot
        return lot

    # -- the subset of the pymongo collection the service uses --------------
    async def update_one(self, query: dict, update: dict) -> _UpdateResult:
        lot = self.lots[query["_id"]]
        delta = update["$inc"]["used"]
        if query.get("is_revoked") is False and lot.is_revoked:
            return _UpdateResult(False)
        if "$expr" in query and lot.used + delta > lot.points:
            return _UpdateResult(False)
        lot.used += delta
        return _UpdateResult(True)


@pytest.fixture
def store(monkeypatch):
    store = _Store()

    class _Lots:
        # Query expressions are evaluated against these, then ignored.
        source = object()
        invoice_id = object()

        @staticmethod
        def get_pymongo_collection():
            return store

        @staticmethod
        async def find_one(*_conditions):
            return next((lot for lot in store.lots.values() if lot.source == PointsSource.invoice), None)

    async def _lots_for(cust_id):
        lots = [lot for lot in store.lots.values() if lot.cust_id == cust_id]
        return sorted(lots, key=lambda lot: (lot.expires_at, lot.id))

    async def _grant(cust_id, points, expires_on, source, note="", invoice_id=None):
        store.granted.append({"cust_id": cust_id, "points": points, "expires_on": expires_on, "invoice_id": invoice_id})
        return store.add(cust_id, points, expires_on, source=source, invoice_id=invoice_id)

    monkeypatch.setattr(customer_points, "CustomerPointsLot", _Lots)
    monkeypatch.setattr(customer_points, "get_customer_lots", _lots_for)
    monkeypatch.setattr(customer_points, "grant_points", _grant)
    return store


# ---------------------------------------------------------------------------
# Expiry and the balance
# ---------------------------------------------------------------------------


def test_points_default_to_three_weeks_out():
    assert customer_points.default_expiry(TODAY) == date(2026, 10, 30)


def test_a_lot_counts_up_to_the_day_before_it_expires(store):
    lot = store.add(1, 100, TODAY + timedelta(days=1))

    assert customer_points.is_live(lot, TODAY)
    assert not customer_points.is_live(lot, TODAY + timedelta(days=1))


def test_the_balance_is_unspent_points_on_live_lots_only(store):
    store.add(1, 100, TODAY + timedelta(days=5), used=30)
    store.add(1, 50, TODAY)  # expires today: already worth nothing
    store.add(1, 40, TODAY + timedelta(days=5), is_revoked=True)

    assert customer_points.available_points(store.lots.values(), TODAY) == 70


# ---------------------------------------------------------------------------
# The two 5% figures
# ---------------------------------------------------------------------------


def test_an_invoice_earns_five_percent_rounded_down():
    assert customer_points.invoice_reward_points(1180.0) == 59
    assert customer_points.invoice_reward_points(1199.80) == 59


def test_an_order_can_take_at_most_five_percent_rounded_down():
    assert customer_points.max_redeemable_points(1000.0) == 50
    assert customer_points.max_redeemable_points(999.0) == 49


def test_float_noise_cannot_cost_a_point():
    # 0.05 isn't exact in binary; 20 * 0.05 must still be 1, not 0.
    assert customer_points.max_redeemable_points(20.0) == 1


# ---------------------------------------------------------------------------
# Spending points on an order
# ---------------------------------------------------------------------------


def test_redemption_draws_the_soonest_expiring_points_first(store):
    later = store.add(1, 100, TODAY + timedelta(days=20))
    sooner = store.add(1, 30, TODAY + timedelta(days=2))

    allocations = asyncio.run(customer_points.redeem_points(1, 50, TODAY))

    assert [(a.lot_id, a.points) for a in allocations] == [(sooner.id, 30), (later.id, 20)]
    assert (sooner.used, later.used) == (30, 20)


def test_redeeming_more_than_the_balance_is_refused_and_takes_nothing(store):
    lot = store.add(1, 30, TODAY + timedelta(days=2))

    with pytest.raises(HTTPException) as error:
        asyncio.run(customer_points.redeem_points(1, 31, TODAY))

    assert error.value.status_code == 400
    assert lot.used == 0


def test_expired_points_cannot_be_redeemed(store):
    store.add(1, 100, TODAY)

    with pytest.raises(HTTPException):
        asyncio.run(customer_points.redeem_points(1, 10, TODAY))


def test_an_unchanged_order_keeps_its_allocations_untouched(store):
    lot = store.add(1, 100, TODAY + timedelta(days=2), used=40)
    current = [PointsAllocation(lot_id=lot.id, points=40)]

    result = asyncio.run(customer_points.reconcile_order_points(current, 1, 1, 40, TODAY))

    assert result is current
    assert lot.used == 40


def test_lowering_an_orders_points_hands_the_difference_back(store):
    lot = store.add(1, 100, TODAY + timedelta(days=2), used=40)

    result = asyncio.run(
        customer_points.reconcile_order_points([PointsAllocation(lot_id=lot.id, points=40)], 1, 1, 10, TODAY)
    )

    assert [(a.lot_id, a.points) for a in result] == [(lot.id, 10)]
    assert lot.used == 10


def test_deleting_an_order_hands_all_its_points_back(store):
    lot = store.add(1, 100, TODAY + timedelta(days=2), used=40)

    result = asyncio.run(
        customer_points.reconcile_order_points([PointsAllocation(lot_id=lot.id, points=40)], 1, 1, 0, TODAY)
    )

    assert result == []
    assert lot.used == 0


def test_an_order_keeps_points_from_a_lot_that_has_since_expired(store):
    # Claimed while live; re-saving the order later (with a smaller amount)
    # must not strip them just because the lot has expired in the meantime.
    lot = store.add(1, 100, TODAY - timedelta(days=1), used=40)

    result = asyncio.run(
        customer_points.reconcile_order_points([PointsAllocation(lot_id=lot.id, points=40)], 1, 1, 25, TODAY)
    )

    assert [(a.lot_id, a.points) for a in result] == [(lot.id, 25)]
    assert lot.used == 25


def test_moving_an_order_to_another_client_moves_the_points(store):
    old = store.add(1, 100, TODAY + timedelta(days=2), used=40)
    new = store.add(2, 100, TODAY + timedelta(days=2))

    asyncio.run(
        customer_points.reconcile_order_points([PointsAllocation(lot_id=old.id, points=40)], 1, 2, 40, TODAY)
    )

    assert (old.used, new.used) == (0, 40)


def test_a_rejected_edit_leaves_the_balance_as_it_was(store):
    lot = store.add(1, 50, TODAY + timedelta(days=2), used=40)

    with pytest.raises(HTTPException):
        asyncio.run(
            customer_points.reconcile_order_points([PointsAllocation(lot_id=lot.id, points=40)], 1, 1, 60, TODAY)
        )

    assert lot.used == 40


# ---------------------------------------------------------------------------
# Earning points off a paid invoice
# ---------------------------------------------------------------------------


class _Invoice:
    def __init__(self, status=InvoiceStatus.paid, is_deleted=False, invoice_type=InvoiceType.standard):
        self.id = 7
        self.invoice_no = 12
        self.invoice_fy_start_year = 2026
        self.type = invoice_type
        self.status = status
        self.is_deleted = is_deleted
        self.date = datetime(2026, 10, 1, 11, 30)
        self.total_amount_after_tax = 1180.0


async def _client_one():
    return 1


def _sync(invoice):
    asyncio.run(customer_points.sync_invoice_reward(invoice, _client_one))


def test_a_paid_invoice_earns_five_percent_expiring_three_weeks_from_its_date(store):
    _sync(_Invoice())

    assert store.granted == [{"cust_id": 1, "points": 59, "expires_on": date(2026, 10, 22), "invoice_id": 7}]


def test_an_invoice_only_ever_earns_once(store):
    _sync(_Invoice())
    _sync(_Invoice())

    assert len(store.granted) == 1


def test_going_back_to_unpaid_revokes_the_reward_and_paying_again_reinstates_it(store):
    _sync(_Invoice())
    lot = next(iter(store.lots.values()))

    _sync(_Invoice(status=InvoiceStatus.unpaid))
    assert lot.is_revoked

    _sync(_Invoice())
    assert not lot.is_revoked
    assert len(store.granted) == 1


def test_voiding_a_paid_invoice_revokes_its_reward(store):
    _sync(_Invoice())

    _sync(_Invoice(is_deleted=True))

    assert next(iter(store.lots.values())).is_revoked


def test_unpaid_and_proforma_invoices_earn_nothing(store):
    _sync(_Invoice(status=InvoiceStatus.unpaid))
    _sync(_Invoice(invoice_type=InvoiceType.proforma))

    assert store.granted == []
