# Unit tests for the draft -> issued lifecycle of standard invoices
# (InvoiceState in app/models/invoice_details.py, and update_invoice_details/
# issue_invoice/delete_draft_invoice in app/api/routes/invoices.py).
#
# What matters most is the lock: once issued, nothing on the document that
# went out changes except its payment state (or cancelling it). And a draft,
# which hasn't gone out, can't be paid, cancelled or seen by the client.
#
# InvoiceDetails is stubbed rather than queried: building a real Beanie query
# expression needs init_beanie against a live Mongo, which these tests
# deliberately don't have (same approach as test_invoice_status_update.py).
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes import customer_invoices, invoices
from app.models import InvoiceBilling, InvoiceState, InvoiceStatus, InvoiceType
from app.schemas.invoices import DeleteDraftInvoiceRequest, IssueInvoiceRequest, UpdateInvoiceDetailsRequest
from app.services.invoice_numbering import format_sales_invoice_no

_ISSUED_ON = datetime(2026, 11, 2)
_EDITED_TO = datetime(2026, 11, 20)


class _StubInvoice:
    def __init__(self, state: InvoiceState, is_deleted: bool = False) -> None:
        self.id = 7
        self.invoice_no = 40 if state == InvoiceState.issued else None
        self.invoice_fy_start_year = 2026 if state == InvoiceState.issued else None
        self.type = InvoiceType.standard
        self.state = state
        self.is_deleted = is_deleted
        self.voided_by_cancellation = False
        self.status = InvoiceStatus.unpaid
        self.paid_on = None
        self.billing = InvoiceBilling.partial
        self.partial_percent = 50.0
        self.partial_amount = None
        self.date = _ISSUED_ON
        self.due_date = _ISSUED_ON
        self.notes = "as issued"
        self.transport = "Hand Delivery"
        self.total_amount_before_tax = 500.0
        self.total_tax_amount = 90.0
        self.total_amount_after_tax = 590.0
        self.saves = 0
        self.deleted = False

    async def save(self) -> None:
        self.saves += 1

    async def delete(self) -> None:
        self.deleted = True


class _StubInvoices:
    invoice: _StubInvoice | None = None

    @classmethod
    async def get(cls, _id):
        return cls.invoice


@pytest.fixture
def stub(monkeypatch):
    async def _no_points(_invoice, _resolve):
        return None

    async def _no_retotal(_partial):
        return None

    monkeypatch.setattr(invoices, "InvoiceDetails", _StubInvoices)
    monkeypatch.setattr(invoices, "sync_invoice_reward", _no_points)
    monkeypatch.setattr(invoices, "_retotal_full_beside", _no_retotal)

    def _make(state: InvoiceState, **kwargs) -> _StubInvoice:
        _StubInvoices.invoice = _StubInvoice(state, **kwargs)
        return _StubInvoices.invoice

    return _make


def _update(**overrides):
    fields = dict(
        id=7,
        date=_EDITED_TO,
        due_date=_EDITED_TO,
        online_or_offline="online",
        transport="Courier",
        notes="edited",
        status=InvoiceStatus.unpaid,
    )
    fields.update(overrides)
    return asyncio.run(invoices.update_invoice_details(UpdateInvoiceDetailsRequest(**fields), None))


# --- numbering ---------------------------------------------------------------


def test_a_draft_goes_by_its_row_id_not_a_series_number():
    draft = SimpleNamespace(id=12, invoice_no=None, type=InvoiceType.standard, invoice_fy_start_year=None)
    assert format_sales_invoice_no(draft) == "DRAFT-12"


def test_an_issued_invoice_keeps_its_series_number():
    issued = SimpleNamespace(id=12, invoice_no=40, type=InvoiceType.standard, invoice_fy_start_year=2026, date=_ISSUED_ON)
    assert format_sales_invoice_no(issued) == "H/26-27/40"


# --- the lock on an issued invoice --------------------------------------------


def test_an_issued_invoice_ignores_edits_to_what_it_printed(stub):
    invoice = stub(InvoiceState.issued)

    _update()

    assert invoice.date == _ISSUED_ON
    assert invoice.due_date == _ISSUED_ON
    assert invoice.notes == "as issued"
    assert invoice.transport == "Hand Delivery"
    assert invoice.total_amount_after_tax == 590.0


def test_an_issued_invoice_still_takes_a_payment(stub, monkeypatch):
    monkeypatch.setattr(invoices, "today", lambda: _EDITED_TO.date())
    invoice = stub(InvoiceState.issued)

    _update(status=InvoiceStatus.paid)

    assert invoice.status == InvoiceStatus.paid
    assert invoice.saves == 1


def test_an_issued_invoice_can_be_cancelled(stub):
    invoice = stub(InvoiceState.issued)

    _update(is_deleted=True)

    assert invoice.is_deleted is True


def test_an_issued_invoice_refuses_a_billing_change(stub):
    invoice = stub(InvoiceState.issued)

    with pytest.raises(HTTPException) as error:
        _update(billing=InvoiceBilling.partial, partial_percent=30.0)

    assert error.value.status_code == 409
    assert invoice.saves == 0


def test_resending_an_issued_invoices_own_billing_is_not_a_change(stub):
    invoice = stub(InvoiceState.issued)

    _update(billing=InvoiceBilling.partial, partial_percent=50.0)

    assert invoice.saves == 1


# --- what a draft can't do -----------------------------------------------------


def test_a_draft_cant_be_marked_paid(stub):
    invoice = stub(InvoiceState.draft)

    with pytest.raises(HTTPException) as error:
        _update(status=InvoiceStatus.paid)

    assert error.value.status_code == 400
    assert invoice.saves == 0


def test_a_draft_is_deleted_not_cancelled(stub):
    invoice = stub(InvoiceState.draft)

    with pytest.raises(HTTPException) as error:
        _update(is_deleted=True)

    assert error.value.status_code == 400
    assert invoice.saves == 0


def test_a_draft_can_be_deleted(stub):
    invoice = stub(InvoiceState.draft)

    asyncio.run(invoices.delete_draft_invoice(DeleteDraftInvoiceRequest(id=7), None))

    assert invoice.deleted is True


def test_an_issued_invoice_cant_be_deleted(stub):
    invoice = stub(InvoiceState.issued)

    with pytest.raises(HTTPException) as error:
        asyncio.run(invoices.delete_draft_invoice(DeleteDraftInvoiceRequest(id=7), None))

    assert error.value.status_code == 409
    assert invoice.deleted is False


# --- issuing ---------------------------------------------------------------


def test_an_invoice_is_only_issued_once(stub):
    stub(InvoiceState.issued)

    with pytest.raises(HTTPException) as error:
        asyncio.run(invoices.issue_invoice(IssueInvoiceRequest(id=7), None))

    assert error.value.status_code == 409


def test_a_cancelled_draft_cant_be_issued(stub):
    stub(InvoiceState.draft, is_deleted=True)

    with pytest.raises(HTTPException) as error:
        asyncio.run(invoices.issue_invoice(IssueInvoiceRequest(id=7), None))

    assert error.value.status_code == 409


# --- the request's billing fields ----------------------------------------------


def test_a_partial_figure_needs_billing_set():
    with pytest.raises(ValidationError):
        UpdateInvoiceDetailsRequest(
            id=7,
            date=_EDITED_TO,
            due_date=_EDITED_TO,
            online_or_offline="online",
            status=InvoiceStatus.unpaid,
            partial_percent=30.0,
        )


def test_a_partial_billing_needs_a_figure():
    with pytest.raises(ValidationError):
        UpdateInvoiceDetailsRequest(
            id=7,
            date=_EDITED_TO,
            due_date=_EDITED_TO,
            online_or_offline="online",
            status=InvoiceStatus.unpaid,
            billing=InvoiceBilling.partial,
        )


# --- the client portal -----------------------------------------------------------


def test_the_client_portal_doesnt_serve_a_draft(monkeypatch):
    class _PortalInvoices:
        @classmethod
        async def get(cls, _id):
            return _StubInvoice(InvoiceState.draft)

    monkeypatch.setattr(customer_invoices, "InvoiceDetails", _PortalInvoices)

    with pytest.raises(HTTPException) as error:
        asyncio.run(customer_invoices._get_owned_invoice_or_404(7, SimpleNamespace(id=1)))

    assert error.value.status_code == 404


# --- a draft partial beside its draft balance invoice ---------------------------


def _billing_invoice(invoice_id, billing, state, after_tax, percent=None):
    return SimpleNamespace(
        id=invoice_id,
        sales_ids=[1],
        type=InvoiceType.standard,
        is_deleted=False,
        state=state,
        billing=billing,
        partial_percent=percent,
        partial_amount=None,
        total_amount_before_tax=after_tax / 1.18,
        total_tax_amount=after_tax - after_tax / 1.18,
        total_amount_after_tax=after_tax,
    )


_ORDER = SimpleNamespace(
    id=1, order_no=1, total_amount_before_tax=1000.0, total_tax_amount=180.0, total_amount_after_tax=1180.0
)


@pytest.mark.parametrize(
    ("balance_state", "allowed"),
    [(InvoiceState.draft, True), (InvoiceState.issued, False)],
)
def test_a_draft_partial_isnt_blocked_by_its_own_draft_balance_invoice(monkeypatch, balance_state, allowed):
    # Raised partial first, balance second, both drafts: the partial must
    # stay editable and issuable, as the draft balance just follows it. A
    # balance that has already been issued is frozen, so it still blocks.
    partial = _billing_invoice(1, InvoiceBilling.partial, InvoiceState.draft, 590.0, percent=50.0)
    balance = _billing_invoice(2, InvoiceBilling.full, balance_state, 590.0)

    async def _live(_orders, exclude_invoice_id=None):
        return [invoice for invoice in (partial, balance) if invoice.id != exclude_invoice_id]

    monkeypatch.setattr(invoices, "_live_standard_invoices_on", _live)
    monkeypatch.setattr(
        "app.services.invoice_totals.format_sales_invoice_no", lambda invoice: f"No {invoice.id}"
    )
    check = invoices._check_billing_room([_ORDER], partial, exclude_invoice_id=1, draft_partial=True)

    if allowed:
        assert asyncio.run(check) == []
    else:
        with pytest.raises(HTTPException) as error:
            asyncio.run(check)
        assert error.value.status_code == 409
