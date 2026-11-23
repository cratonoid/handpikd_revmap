# Unit tests for delete_purchase_order (app/api/routes/orders.py): only an
# Administrator may delete a purchase order, only when no sales invoice
# depends on it, and deleting it undoes its stock, voids its invoice and
# unlinks it from sales orders.
#
# Beanie is stubbed out, as in test_purchase_order_duplicate_guard.py.
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.deps import require_administrator
from app.api.routes import orders
from app.schemas.purchase_orders import DeletePurchaseOrderRequest


class _Field:
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _Query:
    def __init__(self, rows: list) -> None:
        self.rows = rows
        self.deleted = False

    async def to_list(self) -> list:
        return self.rows

    async def delete(self) -> None:
        self.deleted = True


def _doc(**fields) -> SimpleNamespace:
    doc = SimpleNamespace(saved=0, removed=False, **fields)

    async def save() -> None:
        doc.saved += 1

    async def delete() -> None:
        doc.removed = True

    doc.save = save
    doc.delete = delete
    return doc


@pytest.fixture
def world(monkeypatch):
    state = SimpleNamespace(
        order=_doc(id=5, date=datetime(2026, 11, 1)),
        sales_orders=[_doc(id=40, related_purchase_order_ids=[5, 6])],
        sales_invoice=None,
        invoices=[_doc(id=7, is_deleted=False)],
        lines=[SimpleNamespace(product_id=48), SimpleNamespace(product_id=52)],
        applied={48: 10, 52: 3},
        shortfalls=[],
        stock_calls=[],
        rate_syncs=[],
        summary_query=None,
    )

    class _Orders:
        @staticmethod
        async def get(order_id):
            return state.order if order_id == state.order.id else None

    class _Sales:
        related_purchase_order_ids = _Field("related_purchase_order_ids")

        @staticmethod
        def find(*_args):
            return _Query(state.sales_orders)

    class _Invoices:
        sales_ids = _Field("sales_ids")

        @staticmethod
        async def find_one(*_args):
            return state.sales_invoice

    class _PurchaseInvoices:
        po_id = _Field("po_id")
        is_deleted = _Field("is_deleted")

        @staticmethod
        def find(*_args):
            return _Query(state.invoices)

    class _Summary:
        purchase_order_id = _Field("purchase_order_id")

        @staticmethod
        def find(*_args):
            state.summary_query = _Query(state.lines)
            return state.summary_query

    async def applied(_order_id):
        return state.applied

    async def shortfalls(_deltas):
        return state.shortfalls

    async def labels(rows):
        return {product_id: f"product {product_id}" for product_id, _, _ in rows}

    async def apply_stock(*args):
        state.stock_calls.append(args)

    async def sync_rates(product_ids):
        state.rate_syncs.append(product_ids)

    monkeypatch.setattr(orders, "PurchaseOrders", _Orders)
    monkeypatch.setattr(orders, "SalesOrders", _Sales)
    monkeypatch.setattr(orders, "InvoiceDetails", _Invoices)
    monkeypatch.setattr(orders, "PurchaseInvoiceDetails", _PurchaseInvoices)
    monkeypatch.setattr(orders, "PurchaseSummary", _Summary)
    monkeypatch.setattr(orders, "In", lambda field, values: ("in", field.name, values))
    monkeypatch.setattr(orders, "get_applied_purchase_quantities", applied)
    monkeypatch.setattr(orders, "find_stock_shortfalls", shortfalls)
    monkeypatch.setattr(orders, "stock_shortfall_labels", labels)
    monkeypatch.setattr(orders, "apply_purchase_order_stock", apply_stock)
    monkeypatch.setattr(orders, "sync_vendor_rates_from_purchases", sync_rates)
    return state


def _delete(order_id: int = 5):
    return asyncio.run(orders.delete_purchase_order(DeletePurchaseOrderRequest(id=order_id), None))


def test_only_an_administrator_may_delete():
    route = next(r for r in orders.router.routes if r.path.endswith("/delete_purchase_order"))
    assert any(dep.call is require_administrator for dep in route.dependant.dependencies)


def test_an_order_behind_a_sales_invoice_is_refused(world):
    world.sales_invoice = SimpleNamespace(invoice_no=118)

    with pytest.raises(HTTPException) as error:
        _delete()

    assert error.value.status_code == 409
    assert "invoice 118" in error.value.detail
    assert not world.order.removed and world.stock_calls == []


def test_an_order_whose_stock_has_been_sold_on_is_refused(world):
    world.shortfalls = [(48, 4, -10)]

    with pytest.raises(HTTPException) as error:
        _delete()

    assert error.value.status_code == 400
    assert "product 48" in error.value.detail
    assert not world.order.removed


def test_deleting_undoes_the_order(world):
    _delete()

    # Every unit it added comes back out, and its ledger is replaced by nothing.
    ((order_id, product_ids, quantities, deltas, _date),) = world.stock_calls
    assert (order_id, product_ids, quantities) == (5, [], [])
    assert deltas == {48: -10, 52: -3}
    assert world.summary_query.deleted
    # The invoice is voided, not removed, so its number isn't reused.
    assert world.invoices[0].is_deleted is True
    # The (uninvoiced) sales order keeps its other links.
    assert world.sales_orders[0].related_purchase_order_ids == [6]
    assert world.order.removed
    assert world.rate_syncs == [[48, 52]]


def test_an_unknown_order_is_a_404(world):
    with pytest.raises(HTTPException) as error:
        _delete(999)

    assert error.value.status_code == 404
