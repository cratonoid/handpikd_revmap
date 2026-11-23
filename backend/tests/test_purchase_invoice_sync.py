# Unit tests for "editing a purchase order updates its purchase invoice":
# sync_purchase_invoice_with_order (services/purchase_invoices.py) and its
# printing twin. Invoices used to keep the figures their order had when they
# were raised, so an edited order and its invoice disagreed on the totals.
#
# Beanie is stubbed out, as in test_purchase_order_duplicate_guard.py: these
# tests deliberately run without a live Mongo.
import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import printing_purchase_invoices, purchase_invoices
from app.services.gst import TaxKind


class _Field:
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other: object) -> tuple:  # type: ignore[override]
        return ("eq", self.name, other)


class _Query:
    def __init__(self, rows: list) -> None:
        self.rows = rows

    async def to_list(self) -> list:
        return self.rows


def _invoice(**fields) -> SimpleNamespace:
    invoice = SimpleNamespace(
        id=7,
        purchase_invoice_no=31,
        date=datetime(2026, 11, 1),
        vendor_id=2,
        vendor_invoice_no="HPM/26-27/900",
        uploaded_pdf_path="purchase_invoices/7.pdf",
        total_amount_before_tax=1000.0,
        total_tax_amount=180.0,
        total_amount_after_tax=1180.0,
        tax_kind=TaxKind.igst,
        place_of_supply_code="27",
        place_of_supply_name="Maharashtra",
        total_igst_amount=180.0,
        total_cgst_amount=0.0,
        total_sgst_amount=0.0,
        saved=0,
        **fields,
    )

    async def save() -> None:
        invoice.saved += 1

    invoice.save = save
    return invoice


def _stub_invoices(monkeypatch, module, model_name: str, rows: list) -> list:
    calls: list = []

    class _Stub:
        po_id = _Field("po_id")
        is_deleted = _Field("is_deleted")

        @staticmethod
        def find(*args):
            calls.append(args)
            return _Query(rows)

    monkeypatch.setattr(module, model_name, _Stub)
    return calls


def _stub_vendor(monkeypatch, module, state_code: str = "27") -> None:
    class _Vendors:
        @staticmethod
        async def get(_vendor_id):
            return SimpleNamespace(state_code=state_code, gst=None)

    monkeypatch.setattr(module, "VendorDetails", _Vendors)


def _edited_order(**fields) -> SimpleNamespace:
    order = dict(
        id=5,
        vendor_id=2,
        date=datetime(2026, 11, 20),
        total_amount_before_tax=2000.0,
        total_amount_after_tax=2360.0,
        tax_kind=TaxKind.cgst_sgst,
        sgst_perc=9.0,
        cgst_perc=9.0,
        igst_perc=None,
    )
    return SimpleNamespace(**{**order, **fields})


@pytest.mark.parametrize(
    ("module", "model_name", "sync"),
    [
        (purchase_invoices, "PurchaseInvoiceDetails", purchase_invoices.sync_purchase_invoice_with_order),
        (
            printing_purchase_invoices,
            "PrintingPurchaseInvoiceDetails",
            printing_purchase_invoices.sync_printing_purchase_invoice_with_order,
        ),
    ],
)
def test_an_edited_order_rewrites_its_invoice_figures(monkeypatch, module, model_name, sync):
    invoice = _invoice()
    calls = _stub_invoices(monkeypatch, module, model_name, [invoice])
    _stub_vendor(monkeypatch, module)

    asyncio.run(sync(_edited_order(vendor_id=3)))

    assert invoice.saved == 1
    assert invoice.vendor_id == 3
    assert invoice.total_amount_before_tax == 2000.0
    assert invoice.total_amount_after_tax == 2360.0
    assert invoice.total_tax_amount == 360.0
    # The order switched from IGST to CGST+SGST, and the heads follow it.
    assert invoice.tax_kind == TaxKind.cgst_sgst
    assert (invoice.total_igst_amount, invoice.total_cgst_amount, invoice.total_sgst_amount) == (0.0, 180.0, 180.0)
    # Only live invoices for this order are touched.
    (query,) = calls
    assert ("eq", "po_id", 5) in query
    assert ("eq", "is_deleted", False) in query


def test_the_invoices_own_identity_is_left_alone(monkeypatch):
    invoice = _invoice()
    _stub_invoices(monkeypatch, purchase_invoices, "PurchaseInvoiceDetails", [invoice])
    _stub_vendor(monkeypatch, purchase_invoices)

    asyncio.run(purchase_invoices.sync_purchase_invoice_with_order(_edited_order()))

    # Its number, its own date (editable on the invoices screen), the vendor's
    # invoice number and the attached PDF all belong to the invoice, not the order.
    assert invoice.purchase_invoice_no == 31
    assert invoice.date == datetime(2026, 11, 1)
    assert invoice.vendor_invoice_no == "HPM/26-27/900"
    assert invoice.uploaded_pdf_path == "purchase_invoices/7.pdf"


def test_an_order_with_no_live_invoice_is_a_no_op(monkeypatch):
    _stub_invoices(monkeypatch, purchase_invoices, "PurchaseInvoiceDetails", [])
    _stub_vendor(monkeypatch, purchase_invoices)

    asyncio.run(purchase_invoices.sync_purchase_invoice_with_order(_edited_order()))
