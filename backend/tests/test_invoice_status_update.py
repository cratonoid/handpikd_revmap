# Unit tests for update_invoice_status in app/api/routes/invoices.py — the
# narrow endpoint behind the Status dropdown in each row of the admin sales
# invoices table.
#
# The point of the endpoint is what it does NOT do. update_invoice_details
# can set the status too, but on its way past it re-snapshots the totals off
# the linked sales orders and re-decides the invoice's tax context against
# the client's current state. That is right when an admin has reviewed the
# invoice on the form, and wrong when they are only recording that the money
# arrived on a document already sent to the client — so the totals staying
# put is the behaviour worth pinning down here.
#
# InvoiceDetails is stubbed rather than queried: building a real Beanie query
# expression needs init_beanie against a live Mongo, which these tests
# deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import invoices
from app.models import InvoiceStatus, InvoiceType
from app.schemas.invoices import UpdateInvoiceStatusRequest


class _StubInvoice:
    def __init__(
        self,
        invoice_type: InvoiceType = InvoiceType.standard,
        status: InvoiceStatus = InvoiceStatus.unpaid,
        is_deleted: bool = False,
    ) -> None:
        self.id = 3
        self.type = invoice_type
        self.status = status
        self.is_deleted = is_deleted
        # The figures update_invoice_details would recompute, and this
        # endpoint must not.
        self.total_amount_before_tax = 1000.0
        self.total_tax_amount = 180.0
        self.total_amount_after_tax = 1180.0
        self.total_igst_amount = 180.0
        self.saves = 0

    async def save(self) -> None:
        self.saves += 1


class _StubInvoices:
    invoice: _StubInvoice | None = None

    @classmethod
    async def get(cls, _id):
        return cls.invoice


@pytest.fixture
def invoice(monkeypatch):
    stub = _StubInvoice()
    _StubInvoices.invoice = stub
    monkeypatch.setattr(invoices, "InvoiceDetails", _StubInvoices)
    return stub


def _run(status: InvoiceStatus):
    return asyncio.run(
        invoices.update_invoice_status(UpdateInvoiceStatusRequest(id=3, status=status), None)
    )


def test_marking_an_invoice_paid_saves_the_new_status(invoice):
    response = _run(InvoiceStatus.paid)

    assert invoice.status == InvoiceStatus.paid
    assert invoice.saves == 1
    assert "updated" in response.message


def test_a_paid_invoice_can_be_put_back_to_unpaid(invoice):
    invoice.status = InvoiceStatus.paid

    _run(InvoiceStatus.unpaid)

    assert invoice.status == InvoiceStatus.unpaid


def test_the_totals_and_tax_context_are_left_exactly_as_they_were(invoice):
    # The whole reason this endpoint exists rather than reusing
    # update_invoice_details: an invoice already sent to a client must not
    # have its figures restated by someone ticking it off as paid.
    _run(InvoiceStatus.paid)

    assert invoice.total_amount_before_tax == 1000.0
    assert invoice.total_tax_amount == 180.0
    assert invoice.total_amount_after_tax == 1180.0
    assert invoice.total_igst_amount == 180.0


def test_a_proforma_invoice_has_no_payment_status(invoice):
    invoice.type = InvoiceType.proforma

    with pytest.raises(HTTPException) as error:
        _run(InvoiceStatus.paid)

    assert error.value.status_code == 400
    assert invoice.saves == 0


def test_a_voided_invoice_is_not_found(invoice):
    invoice.is_deleted = True

    with pytest.raises(HTTPException) as error:
        _run(InvoiceStatus.paid)

    assert error.value.status_code == 404
    assert invoice.saves == 0
