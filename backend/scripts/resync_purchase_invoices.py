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
# judgement call to run, not a shape change. The same check and fix are on
# the Purchase Invoices tab for an Administrator (resync_purchase_invoices_*
# in routes/purchase_invoices.py); the logic lives in
# services/purchase_invoice_resync.py.
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
from app.services.purchase_invoice_resync import resync_purchase_invoices


async def main(apply: bool) -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    await init_beanie(database=client[settings.mongodb_db_name], document_models=DOCUMENT_MODELS)

    results = await resync_purchase_invoices(apply)
    for result in results:
        print(f"  {result.kind} invoice {result.invoice_no} (order {result.purchase_order_no}):")
        for change in result.changes:
            print(f"      {change.field}: {change.old} -> {change.new}")

    verb = "updated" if apply else "would update"
    print(f"{verb}: {len(results)} invoice(s)")
    if not apply and results:
        print("re-run with --apply to write these changes")
    await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: list them only)")
    asyncio.run(main(parser.parse_args().apply))
