# Unit tests for void_unpaid_invoices_for_sales_order
# (app/services/invoice_totals.py) — what cancelling a sales order does to the
# invoices raised against it.
#
# InvoiceDetails is stubbed rather than queried: building a real Beanie query
# expression needs init_beanie against a live Mongo, which these tests
# deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest

from app.models.invoice_details import InvoiceStatus
from app.services import invoice_totals


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _Invoice:
    def __init__(self, status: InvoiceStatus) -> None:
        self.status = status
        self.is_deleted = False
        self.saves = 0

    async def save(self) -> None:
        self.saves += 1


class _StubInvoices:
    type = _Field("type")
    is_deleted = _Field("is_deleted")
    sales_ids = _Field("sales_ids")

    result: list[_Invoice] = []

    @classmethod
    def find(cls, *_args):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.result


@pytest.fixture(autouse=True)
def stubbed(monkeypatch):
    monkeypatch.setattr(invoice_totals, "InvoiceDetails", _StubInvoices)
    monkeypatch.setattr(invoice_totals, "In", lambda *_args: None)


def _run() -> list[_Invoice]:
    return asyncio.run(invoice_totals.void_unpaid_invoices_for_sales_order(5))


def test_an_unpaid_invoice_is_voided():
    invoice = _Invoice(InvoiceStatus.unpaid)
    _StubInvoices.result = [invoice]

    assert _run() == [invoice]
    assert invoice.is_deleted is True
    assert invoice.saves == 1


def test_a_paid_invoice_is_left_alone():
    # Money actually received: refunding it is the admin's call.
    invoice = _Invoice(InvoiceStatus.paid)
    _StubInvoices.result = [invoice]

    assert _run() == []
    assert invoice.is_deleted is False
    assert invoice.saves == 0


def test_a_paid_partial_survives_while_the_unpaid_invoice_beside_it_goes():
    paid_partial = _Invoice(InvoiceStatus.paid)
    unpaid_full = _Invoice(InvoiceStatus.unpaid)
    _StubInvoices.result = [paid_partial, unpaid_full]

    assert _run() == [unpaid_full]
    assert paid_partial.is_deleted is False
    assert unpaid_full.is_deleted is True


def test_an_order_with_no_invoices_voids_nothing():
    _StubInvoices.result = []

    assert _run() == []
