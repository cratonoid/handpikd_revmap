# One-off script: standard invoices gained a draft stage (InvoiceState in
# backend/app/models/invoice_details.py). A draft is editable and re-totalled
# from its sales orders; an issued invoice is frozen, and carries its own copy
# of the grid and billed-to block it printed (issued_lines/issued_party) so a
# later edit to an order, product or client can't restate it.
#
# Every invoice that existed before this change had already gone out, so they
# are all issued. This:
#   1. sets state "issued" on every invoice_details row that has no state;
#   2. snapshots issued_lines/issued_party onto every issued standard invoice
#      that has none yet, from its live data — exactly what its PDF prints
#      today, so nothing on any existing document changes.
#
# Not strictly needed for the site to keep working (every new field has a
# default, and an issued invoice with no snapshot still renders from live
# data), but without step 2 the old invoices wouldn't be frozen.
#
# Safe to re-run: step 1 only matches rows without a state, step 2 only rows
# without a snapshot. An invoice whose data can't be loaded (client or orders
# gone) is reported and left unsnapshotted, rendering live as before.
#
# Run with: venv/Scripts/python.exe scripts/migrate_invoice_draft_state.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from beanie import init_beanie
from fastapi import HTTPException
from pymongo import AsyncMongoClient

from app.core.config import settings


def _beanie_ready() -> bool:
    # Already initialised when a backup restore runs the pending migrations
    # inside the live app (services/backup.py); re-initialising there would
    # rebind every model to a client this script then closes.
    from app.models import InvoiceDetails

    try:
        InvoiceDetails.get_pymongo_collection()
    except Exception:
        return False
    return True


async def _snapshot_issued_invoices() -> None:
    from app.api.routes.invoices import _get_sales_orders_or_404, live_standard_invoice_content
    from app.models import InvoiceDetails, IssuedInvoiceLine
    from dataclasses import asdict

    collection = InvoiceDetails.get_pymongo_collection()

    result = await collection.update_many({"state": {"$exists": False}}, {"$set": {"state": "issued"}})
    print(f"set state 'issued' on {result.modified_count} invoice_details doc(s)")

    pending = await InvoiceDetails.find(
        {"type": "standard", "state": "issued", "issued_lines": None}
    ).to_list()
    print(f"found {len(pending)} issued standard invoice(s) without a snapshot")

    done = 0
    for invoice in pending:
        try:
            sales_orders = await _get_sales_orders_or_404(invoice.sales_ids)
            lines, party = await live_standard_invoice_content(invoice, sales_orders)
        except HTTPException as error:
            print(f"  skipped invoice id {invoice.id}: {error.detail}")
            continue
        await collection.update_one(
            {"_id": invoice.id, "issued_lines": None},
            {
                "$set": {
                    "issued_lines": [IssuedInvoiceLine(**asdict(line)).model_dump() for line in lines],
                    "issued_party": party.model_dump(),
                }
            },
        )
        done += 1
    print(f"snapshotted {done} invoice(s)")


async def main() -> None:
    if _beanie_ready():
        await _snapshot_issued_invoices()
        return

    from app.core.db import DOCUMENT_MODELS

    client = AsyncMongoClient(settings.mongodb_uri)
    try:
        await init_beanie(database=client[settings.mongodb_db_name], document_models=DOCUMENT_MODELS)
        await _snapshot_issued_invoices()
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
