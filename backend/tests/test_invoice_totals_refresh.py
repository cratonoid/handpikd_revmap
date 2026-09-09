# Unit tests for refresh_invoice_totals_for_sales_orders
# (app/services/invoice_totals.py) — the step that keeps an already-raised
# invoice's snapshotted totals in step with the sales order behind it.
#
# It matters because a standard invoice's PDF prints its orders'
# #sales_summary rows LIVE while its grand total comes from the snapshot: if
# the two drift, the document stops adding up. What the tests below pin down
# is as much what this must NOT do — re-decide the GST heads, restate a
# voided invoice, or zero one whose orders have vanished — as what it does.
#
# InvoiceDetails/SalesOrders are stubbed rather than queried: building a real
# Beanie query expression needs init_beanie against a live Mongo, which these
# tests deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest

from app.models.invoice_details import InvoiceType
from app.services import invoice_totals
from app.services.gst import TaxKind


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _Invoice:
    def __init__(
        self,
        invoice_id: int,
        sales_ids: list[int],
        before_tax: float,
        tax: float,
        after_tax: float,
        tax_kind: TaxKind | None = TaxKind.cgst_sgst,
    ) -> None:
        self.id = invoice_id
        self.type = InvoiceType.standard
        self.is_deleted = False
        self.sales_ids = sales_ids
        self.total_amount_before_tax = before_tax
        self.total_tax_amount = tax
        self.total_amount_after_tax = after_tax
        self.tax_kind = tax_kind
        self.total_igst_amount = 0.0
        self.total_cgst_amount = 0.0
        self.total_sgst_amount = 0.0
        self.saves = 0

    async def save(self):
        self.saves += 1

    def totals(self):
        return (self.total_amount_before_tax, self.total_amount_after_tax)


class _Order:
    def __init__(self, order_id: int, before_tax: float, tax: float) -> None:
        self.id = order_id
        self.total_amount_before_tax = before_tax
        self.total_tax_amount = tax
        self.total_amount_after_tax = before_tax + tax


class _StubInvoices:
    type = _Field("type")
    is_deleted = _Field("is_deleted")
    sales_ids = _Field("sales_ids")

    result: list = []

    @classmethod
    def find(cls, *_args):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.result


class _StubOrders:
    id = _Field("id")

    result: list = []

    @classmethod
    def find(cls, *_args):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.result


@pytest.fixture
def db(monkeypatch):
    _StubInvoices.result = []
    _StubOrders.result = []
    monkeypatch.setattr(invoice_totals, "InvoiceDetails", _StubInvoices)
    monkeypatch.setattr(invoice_totals, "SalesOrders", _StubOrders)
    # In() is called with the stub's inert _Field; it only has to not raise.
    monkeypatch.setattr(invoice_totals, "In", lambda field, values: ("in", field.name, values))
    return _StubInvoices, _StubOrders


def _run(sales_order_ids):
    return asyncio.run(invoice_totals.refresh_invoice_totals_for_sales_orders(sales_order_ids))


def test_an_edited_order_restates_the_invoice_raised_against_it(db):
    invoices, orders = db
    # The live case this was written for: an order's amounts were doubled
    # after the invoice was raised.
    invoice = _Invoice(30, [40], before_tax=16750.0, tax=3015.0, after_tax=19765.0)
    invoices.result = [invoice]
    orders.result = [_Order(40, before_tax=33500.0, tax=6030.0)]

    assert _run([40]) == 1
    assert invoice.totals() == (33500.0, 39530.0)
    assert invoice.total_tax_amount == 6030.0
    assert invoice.saves == 1


def test_the_invoice_keeps_the_gst_heads_it_was_raised_under(db):
    invoices, orders = db
    invoice = _Invoice(30, [40], 100.0, 18.0, 118.0, tax_kind=TaxKind.cgst_sgst)
    invoices.result = [invoice]
    orders.result = [_Order(40, before_tax=200.0, tax=36.0)]

    _run([40])

    # Re-split across the SAME heads, never re-decided from the client's
    # state today — nobody is looking at this invoice.
    assert invoice.total_cgst_amount == pytest.approx(18.0)
    assert invoice.total_sgst_amount == pytest.approx(18.0)
    assert invoice.total_igst_amount == 0.0
    assert invoice.tax_kind == TaxKind.cgst_sgst


def test_an_igst_invoice_re_splits_onto_the_single_head(db):
    invoices, orders = db
    invoice = _Invoice(31, [41], 100.0, 18.0, 118.0, tax_kind=TaxKind.igst)
    invoices.result = [invoice]
    orders.result = [_Order(41, before_tax=200.0, tax=36.0)]

    _run([41])

    assert invoice.total_igst_amount == pytest.approx(36.0)
    assert (invoice.total_cgst_amount, invoice.total_sgst_amount) == (0.0, 0.0)


def test_a_pre_tax_kind_invoice_keeps_its_empty_heads(db):
    invoices, orders = db
    # Rows raised before tax_kind existed never had a split; invoice_pdf.py
    # derives one from the two GSTINs at render time for exactly these.
    invoice = _Invoice(9, [12], 100.0, 18.0, 118.0, tax_kind=None)
    invoices.result = [invoice]
    orders.result = [_Order(12, before_tax=200.0, tax=36.0)]

    _run([12])

    assert invoice.total_amount_after_tax == 236.0
    assert (invoice.total_igst_amount, invoice.total_cgst_amount, invoice.total_sgst_amount) == (
        0.0,
        0.0,
        0.0,
    )


def test_an_order_saved_without_moving_its_amounts_writes_nothing(db):
    invoices, orders = db
    # The overwhelmingly common save — a description or status edit. Writing
    # back anyway would churn every invoice behind every order edit.
    invoice = _Invoice(30, [40], 100.0, 18.0, 118.0)
    invoices.result = [invoice]
    orders.result = [_Order(40, before_tax=100.0, tax=18.0)]

    assert _run([40]) == 0
    assert invoice.saves == 0


def test_a_multi_order_invoice_is_re_totalled_from_every_order_it_lists(db):
    invoices, orders = db
    # Only order 40 was edited, but the invoice covers 40 and 41 — re-totalling
    # from the edited one alone would drop the other order off the invoice.
    invoice = _Invoice(30, [40, 41], 300.0, 54.0, 354.0)
    invoices.result = [invoice]
    orders.result = [_Order(40, 400.0, 72.0), _Order(41, 100.0, 18.0)]

    assert _run([40]) == 1
    assert invoice.totals() == (500.0, 590.0)


def test_an_invoice_whose_orders_have_vanished_is_left_alone(db):
    invoices, orders = db
    # A stale total is recoverable; an invoice silently restated to zero
    # because its orders couldn't be loaded is not.
    invoice = _Invoice(30, [40], 100.0, 18.0, 118.0)
    invoices.result = [invoice]
    orders.result = []

    assert _run([40]) == 0
    assert invoice.totals() == (100.0, 118.0)
    assert invoice.saves == 0


def test_an_order_with_no_invoice_against_it_does_nothing(db):
    invoices, _orders = db
    invoices.result = []

    assert _run([40]) == 0


def test_no_order_ids_short_circuits(db):
    assert _run([]) == 0
