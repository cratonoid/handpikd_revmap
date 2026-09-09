# Unit tests for the two gates the client portal's invoice endpoints sit
# behind (app/api/routes/customer_invoices.py):
#
#   - require_customer_account, which turns a signed-in User into the one
#     CustomerDetails row they are allowed to act as, and
#   - _get_owned_invoice_or_404, which is what stops a client reading an
#     invoice raised for somebody else by guessing at its id.
#
# Every /customer route resolves through both, so these are the whole access
# boundary — a client is otherwise handed real invoice line items and a real
# PDF. Worth testing in their own right rather than only through the screens.
#
# CustomerDetails/InvoiceDetails are stubbed rather than queried: building a
# real Beanie query expression needs init_beanie against a live Mongo, which
# these tests deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import customer_invoices
from app.models import UserRole


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _StubUser:
    def __init__(self, user_id: int, role: UserRole) -> None:
        self.id = user_id
        self.role = role


class _StubCustomer:
    def __init__(self, customer_id: int, is_deleted: bool = False) -> None:
        self.id = customer_id
        self.is_deleted = is_deleted


class _StubInvoice:
    def __init__(self, invoice_id: int, is_deleted: bool = False) -> None:
        self.id = invoice_id
        self.is_deleted = is_deleted


class _StubCustomerDetails:
    user_id = _Field("user_id")

    result = None
    calls: list[tuple] = []

    @classmethod
    async def find_one(cls, *args):
        cls.calls.append(args)
        return cls.result


class _StubInvoiceDetails:
    result = None

    @classmethod
    async def get(cls, _invoice_id):
        return cls.result


@pytest.fixture
def customers(monkeypatch):
    _StubCustomerDetails.result = None
    _StubCustomerDetails.calls = []
    monkeypatch.setattr(customer_invoices, "CustomerDetails", _StubCustomerDetails)
    return _StubCustomerDetails


@pytest.fixture
def invoices(monkeypatch):
    _StubInvoiceDetails.result = None
    monkeypatch.setattr(customer_invoices, "InvoiceDetails", _StubInvoiceDetails)
    return _StubInvoiceDetails


def _billed_to(monkeypatch, cust_id):
    async def _resolve(_invoice):
        return cust_id

    monkeypatch.setattr(customer_invoices, "resolve_invoice_customer_id", _resolve)


# ---------------------------------------------------------------------------
# require_customer_account
# ---------------------------------------------------------------------------
def test_a_client_login_resolves_to_their_own_profile(customers):
    customers.result = _StubCustomer(4)

    customer = asyncio.run(
        customer_invoices.require_customer_account(_StubUser(11, UserRole.customer))
    )

    assert customer.id == 4
    # Scoped to the signed-in user, which is the only thing tying a login to
    # a client — nothing here may be taken from the request.
    (query,) = customers.calls
    assert query == (("eq", "user_id", 11),)


def test_an_admin_login_is_refused(customers):
    # An admin has no CustomerDetails row of their own, and the admin screens
    # already show every invoice — falling through to "no profile" would
    # report that as a data problem rather than the wrong door.
    with pytest.raises(HTTPException) as error:
        asyncio.run(customer_invoices.require_customer_account(_StubUser(1, UserRole.admin)))

    assert error.value.status_code == 403
    assert customers.calls == []


def test_a_login_with_no_client_profile_is_refused(customers):
    customers.result = None

    with pytest.raises(HTTPException) as error:
        asyncio.run(customer_invoices.require_customer_account(_StubUser(11, UserRole.customer)))

    assert error.value.status_code == 403


def test_a_closed_client_account_is_refused(customers):
    # Soft-deleting a client has to actually close the portal for them.
    customers.result = _StubCustomer(4, is_deleted=True)

    with pytest.raises(HTTPException) as error:
        asyncio.run(customer_invoices.require_customer_account(_StubUser(11, UserRole.customer)))

    assert error.value.status_code == 403


# ---------------------------------------------------------------------------
# _get_owned_invoice_or_404
# ---------------------------------------------------------------------------
def _fetch(invoice_id: int, customer: _StubCustomer):
    return asyncio.run(customer_invoices._get_owned_invoice_or_404(invoice_id, customer))


def test_an_invoice_billed_to_this_client_is_returned(invoices, monkeypatch):
    invoices.result = _StubInvoice(7)
    _billed_to(monkeypatch, 4)

    assert _fetch(7, _StubCustomer(4)).id == 7


def test_another_clients_invoice_reads_as_missing(invoices, monkeypatch):
    invoices.result = _StubInvoice(7)
    _billed_to(monkeypatch, 9)

    with pytest.raises(HTTPException) as error:
        _fetch(7, _StubCustomer(4))

    # 404, not 403, on purpose: a client walking ids must not be able to tell
    # "not yours" apart from "no such invoice".
    assert error.value.status_code == 404


def test_an_invoice_that_does_not_exist_is_a_404(invoices, monkeypatch):
    invoices.result = None
    _billed_to(monkeypatch, 4)

    with pytest.raises(HTTPException) as error:
        _fetch(7, _StubCustomer(4))

    assert error.value.status_code == 404


def test_a_voided_invoice_is_hidden_even_from_its_own_client(invoices, monkeypatch):
    # An invoice the admin withdrew isn't one as far as the client is
    # concerned — and _owned_invoices leaves it off the list too, so being
    # able to open it by id would contradict the screen it came from.
    invoices.result = _StubInvoice(7, is_deleted=True)
    _billed_to(monkeypatch, 4)

    with pytest.raises(HTTPException) as error:
        _fetch(7, _StubCustomer(4))

    assert error.value.status_code == 404
