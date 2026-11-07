# Unit tests for restore_invoices_voided_by_cancellation
# (app/services/invoice_totals.py) — un-cancelling a sales order brings back
# the invoices its cancellation voided, unless doing so would bill the client
# twice or bill an order that is still off.
#
# InvoiceDetails/SalesOrders are stubbed rather than queried: building a real
# Beanie query expression needs init_beanie against a live Mongo, which these
# tests deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py). The stubs do apply the filters they
# are given, since which invoices the queries pick is the point here.
import asyncio
from types import SimpleNamespace

import pytest

from app.models.invoice_details import InvoiceBilling, InvoiceStatus, InvoiceType
from app.services import invoice_totals

_CANCELLED = 5
_PROCESSING = 2


class _Field:
    # Stands in for a Beanie ExpressionField; `field == value` becomes a
    # condition _matches can apply.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return (self.name, other)


def _matches(row, condition) -> bool:
    name, wanted = condition
    value = getattr(row, name)
    if isinstance(wanted, list):
        return bool(set(value if isinstance(value, list) else [value]) & set(wanted))
    return value == wanted


class _Collection:
    rows: list = []

    @classmethod
    def find(cls, *conditions):
        return SimpleNamespace(to_list=lambda: _rows([r for r in cls.rows if all(_matches(r, c) for c in conditions)]))


async def _rows(rows):
    return rows


class _Invoices(_Collection):
    type = _Field("type")
    is_deleted = _Field("is_deleted")
    voided_by_cancellation = _Field("voided_by_cancellation")
    sales_ids = _Field("sales_ids")
    rows: list = []


class _Orders(_Collection):
    id = _Field("id")
    rows: list = []


class _Invoice(SimpleNamespace):
    async def save(self) -> None:
        self.saves += 1


def _invoice(invoice_id, sales_ids=None, billing=InvoiceBilling.full, voided=True, by_cancellation=True, after_tax=118.0):
    return _Invoice(
        id=invoice_id,
        invoice_no=invoice_id,
        type=InvoiceType.standard,
        status=InvoiceStatus.unpaid,
        sales_ids=sales_ids or [1],
        billing=billing,
        partial_percent=None,
        partial_amount=after_tax if billing == InvoiceBilling.partial else None,
        total_amount_before_tax=100.0,
        total_tax_amount=18.0,
        total_amount_after_tax=after_tax,
        is_deleted=voided,
        voided_by_cancellation=by_cancellation,
        saves=0,
    )


def _order(order_id, status_id=_PROCESSING, is_deleted=False):
    return SimpleNamespace(
        id=order_id,
        order_no=order_id + 100,
        order_status_id=status_id,
        is_deleted=is_deleted,
        total_amount_before_tax=1000.0,
        total_tax_amount=180.0,
        total_amount_after_tax=1180.0,
    )


@pytest.fixture
def refreshed(monkeypatch):
    calls = []

    async def _refresh(sales_order_ids):
        calls.append(sales_order_ids)

    monkeypatch.setattr(invoice_totals, "InvoiceDetails", _Invoices)
    monkeypatch.setattr(invoice_totals, "SalesOrders", _Orders)
    monkeypatch.setattr(invoice_totals, "In", lambda field, values: (field.name, list(values)))
    monkeypatch.setattr(invoice_totals, "format_sales_invoice_no", lambda invoice: f"No {invoice.invoice_no}")
    monkeypatch.setattr(invoice_totals, "refresh_invoice_totals_for_sales_orders", _refresh)
    _Orders.rows = [_order(1)]
    _Invoices.rows = []
    return calls


def _run():
    return asyncio.run(invoice_totals.restore_invoices_voided_by_cancellation(1, _CANCELLED))


def test_an_invoice_the_cancellation_voided_comes_back_and_is_re_totalled(refreshed):
    invoice = _invoice(10)
    _Invoices.rows = [invoice]

    restored, refused = _run()

    assert restored == [invoice]
    assert refused == []
    assert invoice.is_deleted is False
    assert invoice.voided_by_cancellation is False
    # The order may have been edited while the invoice was void.
    assert refreshed == [[1]]


def test_an_invoice_an_admin_voided_stays_void(refreshed):
    invoice = _invoice(10, by_cancellation=False)
    _Invoices.rows = [invoice]

    assert _run() == ([], [])
    assert invoice.is_deleted is True
    assert refreshed == []


def test_an_order_re_billed_meanwhile_keeps_the_old_invoice_void(refreshed):
    invoice = _invoice(10)
    _Invoices.rows = [invoice, _invoice(11, voided=False, by_cancellation=False)]

    restored, refused = _run()

    assert restored == []
    assert refused[0][0] is invoice
    assert "already invoiced" in refused[0][1]
    assert invoice.is_deleted is True


def test_an_invoice_also_on_a_cancelled_order_waits_for_that_order(refreshed):
    invoice = _invoice(10, sales_ids=[1, 2])
    _Invoices.rows = [invoice]
    _Orders.rows = [_order(1), _order(2, status_id=_CANCELLED)]

    restored, refused = _run()

    assert restored == []
    assert "SO-102" in refused[0][1]
    # Still flagged, so un-cancelling the other order brings it back.
    assert invoice.voided_by_cancellation is True

    _Orders.rows = [_order(1), _order(2)]
    restored, refused = _run()

    assert restored == [invoice]
    assert refused == []


def test_a_partial_and_the_full_invoice_beside_it_both_come_back(refreshed):
    # Listed full-first: the partial has to go first regardless, or the live
    # full invoice would block it.
    full = _invoice(10)
    partial = _invoice(11, billing=InvoiceBilling.partial, after_tax=472.0)
    _Invoices.rows = [full, partial]

    restored, refused = _run()

    assert restored == [partial, full]
    assert refused == []
