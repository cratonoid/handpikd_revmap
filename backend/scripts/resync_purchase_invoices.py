# One-off data correction: bring every live purchase invoice (material and
# printing) back in line with the purchase order it was raised against.
#
# Until editing an order also updated its invoice (see
# sync_purchase_invoice_with_order in services/purchase_invoices.py), an
# invoice kept the totals, GST heads and vendor its order had when the
# invoice was raised. Any order edited since then left its invoice stating
# stale figures. This re-copies them using the very functions the app now
# uses on every edit, so a corrected invoice is identical to one the app
# would have written itself.
#
# Touched: vendor_id, the three totals, tax_kind, place of supply and the
# IGST/CGST/SGST amounts. Never touched: the invoice's number, its own date,
# the vendor's invoice number, the attached PDF, or voided invoices.
#
# Read-only by default: it lists every invoice that would change and how.
# Pass --apply to write. Safe to re-run: an invoice that already matches its
# order is left alone. Not registered in run_migrations.py, because it is a
# judgement call to run, not a shape change.
#
# Production:
#   docker compose run --rm backend python scripts/resync_purchase_invoices.py [--apply]
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from beanie import init_beanie
from pymongo import AsyncMongoClient

from app.core.config import settings
from app.core.db import DOCUMENT_MODELS
from app.models import (
    PrintingPurchaseInvoiceDetails,
    PrintingPurchaseOrders,
    PurchaseInvoiceDetails,
    PurchaseOrders,
)
from app.services.printing_purchase_invoices import order_figures_for_printing_invoice
from app.services.purchase_invoices import order_figures_for_invoice


def _differs(current: object, wanted: object) -> bool:
    if isinstance(current, float) or isinstance(wanted, float):
        return round(float(current or 0), 2) != round(float(wanted or 0), 2)
    return current != wanted


async def _resync(label: str, invoice_model, order_model, figures_for, number_field: str, apply: bool) -> int:
    changed = 0
    invoices = await invoice_model.find(invoice_model.is_deleted == False).to_list()  # noqa: E712
    for invoice in sorted(invoices, key=lambda row: row.id):
        order = await order_model.get(invoice.po_id)
        if order is None:
            print(f"  ! {label} invoice {getattr(invoice, number_field)}: order {invoice.po_id} not found, skipped")
            continue
        figures = await figures_for(order)
        diffs = {
            field: (getattr(invoice, field), value)
            for field, value in figures.items()
            if _differs(getattr(invoice, field), value)
        }
        if not diffs:
            continue
        changed += 1
        print(f"  {label} invoice {getattr(invoice, number_field)} (order {order.purchase_order_no}):")
        for field, (old, new) in diffs.items():
            print(f"      {field}: {old} -> {new}")
        if apply:
            for field, value in figures.items():
                setattr(invoice, field, value)
            await invoice.save()
    return changed


async def main(apply: bool) -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    await init_beanie(database=client[settings.mongodb_db_name], document_models=DOCUMENT_MODELS)

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

    verb = "updated" if apply else "would update"
    print(f"{verb}: {material} purchase invoice(s), {printing} printing purchase invoice(s)")
    if not apply and (material or printing):
        print("re-run with --apply to write these changes")
    await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: list them only)")
    asyncio.run(main(parser.parse_args().apply))
