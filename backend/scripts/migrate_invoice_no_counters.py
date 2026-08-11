# One-off script: invoice numbering was split from a single shared
# `invoice_no_counter_master` sequence into two independent, type-scoped
# sequences (StandardInvoiceNoCounterMaster / ProformaInvoiceNoCounterMaster
# — see app/models/standard_invoice_no_counter_master.py,
# proforma_invoice_no_counter_master.py). get_next_id's built-in auto-seed
# (app/services/counters.py) seeds a fresh counter from
# max(InvoiceDetails.id)+1, which is the wrong field entirely for a
# type-scoped invoice_no sequence — this script seeds both new counter docs
# correctly instead, from the actual max invoice_no per type among existing
# invoice_details rows, before the split code path (routes/invoices.py,
# routes/quotations.py) goes live. Safe to re-run: skips any counter
# collection that's already been seeded.
# Run with: venv/Scripts/python.exe scripts/migrate_invoice_no_counters.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

_COUNTER_DOC_ID = 1

_TYPE_TO_COUNTER_COLLECTION = {
    "standard": "standard_invoice_no_counter_master",
    "proforma": "proforma_invoice_no_counter_master",
}


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    invoice_details = db["invoice_details"]

    for invoice_type, counter_collection_name in _TYPE_TO_COUNTER_COLLECTION.items():
        counter_collection = db[counter_collection_name]

        existing = await counter_collection.find_one({"_id": _COUNTER_DOC_ID})
        if existing is not None:
            print(f"{counter_collection_name}: already seeded (next_invoice_no={existing['next_invoice_no']}), skipping")
            continue

        top = await invoice_details.find({"type": invoice_type}).sort("invoice_no", -1).limit(1).to_list(length=1)
        max_no = top[0]["invoice_no"] if top else 0

        await counter_collection.insert_one({"_id": _COUNTER_DOC_ID, "next_invoice_no": max_no})
        print(f"{counter_collection_name}: seeded next_invoice_no={max_no} (from {len(top)} existing {invoice_type} row(s))")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
