# Unit tests for the save-time half of "the same vendor invoice can't be
# recorded twice" — _reject_duplicate_vendor_invoice in
# app/api/routes/orders.py.
#
# There are three guards in total and they cover different moments:
#   - _reject_if_already_recorded (services/purchase_invoice_intake.py) runs
#     when the PDF is uploaded, covered by test_purchase_invoice_intake.py.
#   - this one runs when the order is finally saved, which can be a long
#     review later — and the purchase order number checked alongside it is
#     the wrong key, since the form lets the admin edit it.
#   - a unique index on (vendor_id, vendor_invoice_no) in
#     models/purchase_invoice_details.py is what makes it impossible rather
#     than merely checked, since both of the above read before they write.
#
# PurchaseInvoiceDetails is stubbed out rather than queried: building a real
# Beanie query expression needs init_beanie against a live Mongo, which these
# tests deliberately don't have (same approach as test_accounts.py).
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import orders


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _StubInvoices:
    vendor_id = _Field("vendor_id")
    vendor_invoice_no = _Field("vendor_invoice_no")
    is_deleted = _Field("is_deleted")

    result = None
    calls: list[tuple] = []

    @classmethod
    async def find_one(cls, *args):
        cls.calls.append(args)
        return cls.result


class _Recorded:
    purchase_invoice_no = 12


@pytest.fixture
def invoices(monkeypatch):
    _StubInvoices.result = None
    _StubInvoices.calls = []
    monkeypatch.setattr(orders, "PurchaseInvoiceDetails", _StubInvoices)
    return _StubInvoices


def _run(vendor_id: int, vendor_invoice_no: str | None):
    return asyncio.run(orders._reject_duplicate_vendor_invoice(vendor_id, vendor_invoice_no))


def test_an_invoice_already_recorded_for_this_vendor_is_refused(invoices):
    invoices.result = _Recorded()

    with pytest.raises(HTTPException) as error:
        _run(2, "HPM/26-27/257")

    assert error.value.status_code == 409
    # Names the record that already holds it, so the admin can go and look at
    # it rather than guessing which upload this collided with.
    assert "HPM/26-27/257" in error.value.detail
    assert "purchase invoice 12" in error.value.detail


def test_an_invoice_number_not_on_file_passes(invoices):
    invoices.result = None

    _run(2, "HPM/26-27/257")

    # Scoped to the vendor and to live invoices — the same three terms the
    # unique index is built on.
    (query,) = invoices.calls
    assert ("eq", "vendor_id", 2) in query
    assert ("eq", "vendor_invoice_no", "HPM/26-27/257") in query
    assert ("eq", "is_deleted", False) in query


@pytest.mark.parametrize("vendor_invoice_no", [None, ""])
def test_an_order_keyed_in_by_hand_is_not_checked_at_all(invoices, vendor_invoice_no):
    # Only uploads carry a vendor invoice number. A hand-keyed order stores
    # null, and every one of them would otherwise look like a duplicate of
    # the last.
    invoices.result = _Recorded()

    _run(2, vendor_invoice_no)

    assert invoices.calls == []
