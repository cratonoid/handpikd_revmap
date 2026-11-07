# Unit tests for update_sales_order_status in app/api/routes/sales_orders.py —
# the narrow endpoint behind the Status dropdown in each row of the admin
# sales orders table.
#
# The point of the endpoint is that it does LESS than
# update_sales_order_details (no #sales_summary rewrite, no recomputed
# totals, no po_updated_flag reset), while still doing the one thing a status
# change genuinely has to do: move the order's quantities in or out of
# #inventory as it crosses into or back out of "Delivered"/"Completed". Those
# are the two halves tested here, plus the guard that a refused move leaves
# the order on the status it already had.
#
# SalesOrders/SalesSummary and the inventory service are stubbed rather than
# queried: building a real Beanie query expression needs init_beanie against
# a live Mongo, which these tests deliberately don't have (same approach as
# test_purchase_order_duplicate_guard.py).
import asyncio

import pytest
from fastapi import HTTPException

from app.api.routes import sales_orders
from app.models.invoice_details import InvoiceStatus
from app.schemas.sales_orders import InvoiceChanges, UpdateSalesOrderStatusRequest

_NEW = 1
_DELIVERED = 3
_CANCELLED = 5


class _Field:
    # Stands in for a Beanie ExpressionField so `Model.field == value` builds
    # something inert instead of raising.
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _StubOrder:
    def __init__(self, order_status_id: int, is_deleted: bool = False) -> None:
        self.id = 5
        self.order_status_id = order_status_id
        self.date = "2026-09-10"
        self.is_deleted = is_deleted
        self.po_updated_flag = True
        self.saves = 0

    async def save(self) -> None:
        self.saves += 1


class _StubSalesOrders:
    order: _StubOrder | None = None

    @classmethod
    async def get(cls, _id):
        return cls.order


class _StubLine:
    def __init__(self, product_id: int, quantity: int) -> None:
        self.product_id = product_id
        self.quantity = quantity


class _StubSalesSummary:
    sales_order_id = _Field("sales_order_id")
    lines: list[_StubLine] = []

    @classmethod
    def find(cls, *_args):
        return cls

    @classmethod
    async def to_list(cls):
        return cls.lines


@pytest.fixture
def route(monkeypatch):
    """The endpoint with its collections and inventory service stubbed out.

    Returns a small recorder the tests assert against: which inventory call
    the status change made, if any.
    """
    calls: dict[str, object] = {}

    _StubSalesOrders.order = _StubOrder(_NEW)
    _StubSalesSummary.lines = [_StubLine(7, 4), _StubLine(9, 1)]

    monkeypatch.setattr(sales_orders, "SalesOrders", _StubSalesOrders)
    monkeypatch.setattr(sales_orders, "SalesSummary", _StubSalesSummary)

    async def _status_exists(_order_status_id: int) -> None:
        return None

    async def _deducted_ids() -> set[int]:
        return {_DELIVERED}

    async def _applied(_sales_order_id: int) -> dict[int, int]:
        return calls.get("already_out", {})  # type: ignore[return-value]

    async def _reject(stock_deltas: dict[int, int]) -> None:
        calls["checked"] = stock_deltas
        if calls.get("short"):
            raise HTTPException(status_code=400, detail="insufficient stock for: product 7")

    async def _apply(sales_order_id, product_ids, quantities, stock_deltas, order_date) -> None:
        calls["applied"] = (sales_order_id, product_ids, quantities, stock_deltas, order_date)

    async def _clear(sales_order_id) -> None:
        calls["cleared"] = sales_order_id

    async def _sync_invoices(sales_order_id, previous_status_id, new_status_id) -> InvoiceChanges:
        calls["invoice_sync"] = (sales_order_id, previous_status_id, new_status_id)
        return InvoiceChanges(voided_invoice_nos=calls.get("voided", []))  # type: ignore[arg-type]

    monkeypatch.setattr(sales_orders, "_sync_invoices_with_cancellation", _sync_invoices)
    monkeypatch.setattr(sales_orders, "_validate_order_status_exists", _status_exists)
    monkeypatch.setattr(sales_orders, "_get_stock_deducted_status_ids", _deducted_ids)
    monkeypatch.setattr(sales_orders, "get_applied_sales_quantities", _applied)
    monkeypatch.setattr(sales_orders, "_reject_stock_going_negative", _reject)
    monkeypatch.setattr(sales_orders, "apply_sales_order_stock", _apply)
    monkeypatch.setattr(sales_orders, "clear_sales_order_stock", _clear)
    return calls


def _run(order_status_id: int):
    return asyncio.run(
        sales_orders.update_sales_order_status(
            UpdateSalesOrderStatusRequest(id=5, order_status_id=order_status_id), None
        )
    )


def test_moving_into_delivered_takes_the_orders_quantities_out_of_stock(route):
    response = _run(_DELIVERED)

    assert _StubSalesOrders.order.order_status_id == _DELIVERED
    assert _StubSalesOrders.order.saves == 1
    # The quantities come from #sales_summary, not from the request — the
    # dropdown submits a status and nothing else.
    assert route["applied"][1:3] == ([7, 9], [4, 1])
    assert route["checked"] == {7: -4, 9: -1}
    assert "updated" in response.message


def test_moving_back_out_of_delivered_credits_the_stock_back(route):
    _StubSalesOrders.order = _StubOrder(_DELIVERED)

    _run(_NEW)

    assert _StubSalesOrders.order.order_status_id == _NEW
    assert route["cleared"] == 5
    assert "applied" not in route


def test_a_delivery_there_isnt_stock_for_leaves_the_order_where_it_was(route):
    route["short"] = True

    with pytest.raises(HTTPException) as error:
        _run(_DELIVERED)

    assert error.value.status_code == 400
    # Rejected before the save, so the order is still on its old status
    # rather than reading as delivered with no stock movement behind it.
    assert _StubSalesOrders.order.order_status_id == _NEW
    assert _StubSalesOrders.order.saves == 0


def test_the_po_review_flag_is_not_cleared_by_a_status_change(route):
    # update_sales_order_details clears po_updated_flag because saving the
    # order form counts as having reviewed the change. Flipping a status from
    # a table row is not that review, so the notice has to survive it.
    _run(_DELIVERED)

    assert _StubSalesOrders.order.po_updated_flag is True


def test_reselecting_the_status_it_already_has_touches_nothing(route):
    response = _run(_NEW)

    assert _StubSalesOrders.order.saves == 0
    assert route == {}
    assert "unchanged" in response.message


def test_a_status_change_reports_the_invoices_cancelling_voided(route):
    route["voided"] = ["H/26-27/12", "H/26-27/13"]

    response = _run(_CANCELLED)

    assert route["invoice_sync"] == (5, _NEW, _CANCELLED)
    assert response.invoice_changes.voided_invoice_nos == ["H/26-27/12", "H/26-27/13"]


class _StubInvoice:
    def __init__(
        self, number: int, status: InvoiceStatus = InvoiceStatus.unpaid, sales_ids: list[int] | None = None
    ) -> None:
        self.number = number
        self.status = status
        self.sales_ids = sales_ids or [5]


class _StubStatus:
    def __init__(self, status_id: int) -> None:
        self.id = status_id


class _StubOrderStatusMaster:
    status_name = _Field("status_name")

    @classmethod
    async def find_one(cls, *_args):
        return _StubStatus(_CANCELLED)


@pytest.mark.parametrize(
    ("previous_status_id", "new_status_id", "voided", "restored", "unrestored"),
    [
        (_NEW, _CANCELLED, ["No 12"], [], []),
        (_CANCELLED, _NEW, [], ["No 13"], ["No 14: re-billed"]),
        (_CANCELLED, _DELIVERED, [], ["No 13"], ["No 14: re-billed"]),
        # Re-saving an order on either side of "Cancelled" touches nothing.
        (_CANCELLED, _CANCELLED, [], [], []),
        (_NEW, _NEW, [], [], []),
        (_NEW, _DELIVERED, [], [], []),
    ],
)
def test_only_crossing_cancelled_changes_invoices(
    monkeypatch, previous_status_id, new_status_id, voided, restored, unrestored
):
    async def _void(_sales_order_id: int) -> list[_StubInvoice]:
        return [_StubInvoice(12)]

    async def _restore(_sales_order_id: int, _cancelled_status_id: int):
        return [_StubInvoice(13)], [(_StubInvoice(14), "re-billed")]

    monkeypatch.setattr(sales_orders, "OrderStatusMaster", _StubOrderStatusMaster)
    monkeypatch.setattr(sales_orders, "void_unpaid_invoices_for_sales_order", _void)
    monkeypatch.setattr(sales_orders, "restore_invoices_voided_by_cancellation", _restore)
    monkeypatch.setattr(sales_orders, "format_sales_invoice_no", lambda invoice: f"No {invoice.number}")

    changes = asyncio.run(
        sales_orders._sync_invoices_with_cancellation(5, previous_status_id, new_status_id)
    )

    assert changes.voided_invoice_nos == voided
    assert changes.restored_invoice_nos == restored
    assert changes.unrestored_invoices == unrestored


def test_the_cancellation_impact_splits_invoices_by_what_will_happen_to_them(monkeypatch):
    class _Other:
        id = 6
        order_no = 40

    class _Orders(_StubSalesOrders):
        id = _Field("id")

        @classmethod
        def find(cls, *_args):
            return cls

        @classmethod
        async def to_list(cls):
            return [_Other()]

    async def _live(_sales_order_ids: list[int]) -> list[_StubInvoice]:
        return [
            _StubInvoice(12, InvoiceStatus.unpaid, [5, 6]),
            _StubInvoice(13, InvoiceStatus.unpaid, [5]),
            _StubInvoice(14, InvoiceStatus.paid, [5]),
        ]

    _Orders.order = _StubOrder(_NEW)
    monkeypatch.setattr(sales_orders, "SalesOrders", _Orders)
    monkeypatch.setattr(sales_orders, "In", lambda *_args: None)
    monkeypatch.setattr(sales_orders, "live_standard_invoices_on_sales_orders", _live)
    monkeypatch.setattr(sales_orders, "format_sales_invoice_no", lambda invoice: f"No {invoice.number}")

    impact = asyncio.run(sales_orders.get_sales_order_cancellation_impact(5, None))

    assert [(i.invoice_no_display, i.other_order_nos) for i in impact.unpaid_invoices] == [
        ("No 12", [40]),
        ("No 13", []),
    ]
    assert impact.paid_invoice_nos == ["No 14"]


def test_a_soft_deleted_order_is_not_found(route):
    _StubSalesOrders.order = _StubOrder(_NEW, is_deleted=True)

    with pytest.raises(HTTPException) as error:
        _run(_DELIVERED)

    assert error.value.status_code == 404
