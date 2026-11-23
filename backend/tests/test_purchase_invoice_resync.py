# Unit tests for services/purchase_invoice_resync.py and its Administrator-only
# endpoints: preview lists stale invoices without writing, apply writes, and
# an invoice that already matches its order is left out. Beanie is stubbed.
import asyncio
from types import SimpleNamespace

from app.api.deps import require_administrator
from app.api.routes import purchase_invoices as routes
from app.services import purchase_invoice_resync as resync


class _Field:
    def __eq__(self, other):  # type: ignore[override]
        return ("eq", other)


def _invoice(invoice_id: int, after_tax: float):
    invoice = SimpleNamespace(id=invoice_id, po_id=invoice_id, purchase_invoice_no=invoice_id, is_deleted=False,
                              total_amount_after_tax=after_tax, saved=0)

    async def save():
        invoice.saved += 1

    invoice.save = save
    return invoice


def _stub(monkeypatch, invoices):
    class _Query:
        async def to_list(self):
            return invoices

    class _Invoices:
        is_deleted = _Field()

        @staticmethod
        def find(*_args):
            return _Query()

    class _EmptyInvoices(_Invoices):
        @staticmethod
        def find(*_args):
            class _Empty:
                async def to_list(self):
                    return []

            return _Empty()

    class _Orders:
        @staticmethod
        async def get(order_id):
            return SimpleNamespace(id=order_id, purchase_order_no=f"PO-{order_id}")

    async def figures(order):
        return {"total_amount_after_tax": 1180.0}

    monkeypatch.setattr(resync, "PurchaseInvoiceDetails", _Invoices)
    monkeypatch.setattr(resync, "PurchaseOrders", _Orders)
    monkeypatch.setattr(resync, "order_figures_for_invoice", figures)
    monkeypatch.setattr(resync, "PrintingPurchaseInvoiceDetails", _EmptyInvoices)


def test_preview_lists_only_stale_invoices_and_writes_nothing(monkeypatch):
    stale, fine = _invoice(1, 1000.0), _invoice(2, 1180.0)
    _stub(monkeypatch, [stale, fine])

    (result,) = asyncio.run(resync.resync_purchase_invoices(apply=False))

    assert (result.invoice_id, result.purchase_order_no) == (1, "PO-1")
    assert [(c.field, c.old, c.new) for c in result.changes] == [("total_amount_after_tax", 1000.0, 1180.0)]
    assert stale.saved == 0 and stale.total_amount_after_tax == 1000.0


def test_apply_writes_the_orders_figures(monkeypatch):
    stale = _invoice(1, 1000.0)
    _stub(monkeypatch, [stale])

    asyncio.run(resync.resync_purchase_invoices(apply=True))

    assert stale.saved == 1 and stale.total_amount_after_tax == 1180.0


def test_both_endpoints_are_administrator_only():
    for path in ("/resync_purchase_invoices_preview", "/resync_purchase_invoices_apply"):
        route = next(r for r in routes.router.routes if r.path.endswith(path))
        assert any(dep.call is require_administrator for dep in route.dependant.dependencies)
