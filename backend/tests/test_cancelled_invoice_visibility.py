# Unit tests for how a cancelled invoice (InvoiceDetails.is_deleted) behaves on
# the admin side: listed rather than hidden, and read-only until restored.
#
# InvoiceDetails is stubbed rather than queried: building a real Beanie query
# expression needs init_beanie against a live Mongo, which these tests
# deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.routes import invoices
from app.models.invoice_details import InvoiceType


class _StubInvoices:
    rows: list = []

    @classmethod
    def find_all(cls):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.rows

    @classmethod
    async def get(cls, _id):
        return cls.rows[0]


def _invoice(is_deleted: bool, invoice_type: InvoiceType = InvoiceType.standard):
    return SimpleNamespace(id=1, type=invoice_type, is_deleted=is_deleted)


@pytest.fixture(autouse=True)
def stubbed(monkeypatch):
    monkeypatch.setattr(invoices, "InvoiceDetails", _StubInvoices)


def test_the_admin_list_includes_cancelled_invoices(monkeypatch):
    live, cancelled = _invoice(False), _invoice(True)
    _StubInvoices.rows = [live, cancelled]
    monkeypatch.setattr(invoices, "_to_invoice_detail_item", lambda invoice, _summaries: invoice)

    assert asyncio.run(invoices.get_invoice_details(None)) == [live, cancelled]


@pytest.mark.parametrize(
    ("route", "invoice_type"),
    [
        (invoices.update_invoice_details, InvoiceType.standard),
        (invoices.update_proforma_invoice_details, InvoiceType.proforma),
    ],
)
def test_a_cancelled_invoice_cant_be_edited_without_restoring_it(route, invoice_type):
    _StubInvoices.rows = [_invoice(True, invoice_type)]

    with pytest.raises(HTTPException) as error:
        asyncio.run(route(SimpleNamespace(id=1, is_deleted=True), None))

    assert error.value.status_code == 409
    assert "restore" in error.value.detail


def test_a_live_invoice_and_a_restore_are_not_refused():
    invoices._reject_edit_while_cancelled(_invoice(False), False)
    invoices._reject_edit_while_cancelled(_invoice(False), True)
    invoices._reject_edit_while_cancelled(_invoice(True), False)
