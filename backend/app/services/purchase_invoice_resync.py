# Brings live purchase invoices (material and printing) back in line with
# the orders they were raised against.
#
# Until editing an order also updated its invoice (sync_purchase_invoice_
# with_order in services/purchase_invoices.py), an invoice kept the totals,
# GST heads and vendor its order had when it was raised, so orders edited
# before then left stale invoices. This finds them and, when asked, re-copies
# the figures with the same functions the app uses on every edit.
#
# Used by the Administrator-only preview/apply endpoints in
# routes/purchase_invoices.py and by scripts/resync_purchase_invoices.py.
# Never touched: an invoice's number, its own date, the vendor's invoice
# number, the attached PDF, or voided invoices.
from dataclasses import dataclass

from app.models import (
    PrintingPurchaseInvoiceDetails,
    PrintingPurchaseOrders,
    PurchaseInvoiceDetails,
    PurchaseOrders,
)
from app.services.printing_purchase_invoices import order_figures_for_printing_invoice
from app.services.purchase_invoices import order_figures_for_invoice


@dataclass
class FieldChange:
    field: str
    old: object
    new: object


@dataclass
class InvoiceResync:
    kind: str  # "purchase" or "printing"
    invoice_id: int
    invoice_no: int
    purchase_order_no: str
    changes: list[FieldChange]


def _differs(current: object, wanted: object) -> bool:
    if isinstance(current, float) or isinstance(wanted, float):
        return round(float(current or 0), 2) != round(float(wanted or 0), 2)
    return current != wanted


async def _resync(kind: str, invoice_model, order_model, figures_for, number_field: str, apply: bool):
    results: list[InvoiceResync] = []
    invoices = await invoice_model.find(invoice_model.is_deleted == False).to_list()  # noqa: E712
    for invoice in sorted(invoices, key=lambda row: row.id):
        order = await order_model.get(invoice.po_id)
        if order is None:
            continue
        figures = await figures_for(order)
        changes = [
            FieldChange(field, getattr(invoice, field), value)
            for field, value in figures.items()
            if _differs(getattr(invoice, field), value)
        ]
        if not changes:
            continue
        results.append(
            InvoiceResync(kind, invoice.id, getattr(invoice, number_field), order.purchase_order_no, changes)
        )
        if apply:
            for field, value in figures.items():
                setattr(invoice, field, value)
            await invoice.save()
    return results


async def resync_purchase_invoices(apply: bool) -> list[InvoiceResync]:
    """Every live invoice that disagrees with its order; written when apply is True."""
    material = await _resync(
        "purchase", PurchaseInvoiceDetails, PurchaseOrders, order_figures_for_invoice, "purchase_invoice_no", apply
    )
    printing = await _resync(
        "printing",
        PrintingPurchaseInvoiceDetails,
        PrintingPurchaseOrders,
        order_figures_for_printing_invoice,
        "printing_purchase_invoice_no",
        apply,
    )
    return material + printing
