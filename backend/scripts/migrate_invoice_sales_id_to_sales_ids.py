# One-off script: InvoiceDetails.sales_id (single int FK to SalesOrders,
# standard invoices only) was replaced with sales_ids (list[int]), so a
# standard invoice can be raised against multiple sales orders at once (see
# backend/app/models/invoice_details.py). Existing documents still have the
# old scalar sales_id field — this wraps it into a single-element sales_ids
# array and removes the old field, so Beanie (which validates on read)
# doesn't fail loading pre-existing invoices. Safe to re-run: only matches
# docs that still have a sales_id field.
# Run with: venv/Scripts/python.exe scripts/migrate_invoice_sales_id_to_sales_ids.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db["invoice_details"]

    to_migrate = await collection.count_documents({"sales_id": {"$exists": True}})
    print(f"found {to_migrate} invoice_details doc(s) with a sales_id field")

    if to_migrate:
        # sales_id: <int> -> sales_ids: [<int>]; sales_id: null -> sales_ids: []
        with_value = await collection.update_many(
            {"sales_id": {"$exists": True, "$ne": None}},
            [{"$set": {"sales_ids": ["$sales_id"]}}, {"$unset": "sales_id"}],
        )
        print(f"migrated {with_value.modified_count} doc(s) with a set sales_id")

        # $exists here is required: Mongo's {"sales_id": None} matches BOTH a
        # stored null AND a field that's absent entirely, so without it this
        # would re-match (and re-process) the docs the update above just
        # unset sales_id from.
        null_value = await collection.update_many(
            {"sales_id": {"$exists": True, "$eq": None}},
            {"$set": {"sales_ids": []}, "$unset": {"sales_id": ""}},
        )
        print(f"migrated {null_value.modified_count} doc(s) with sales_id: null")
    else:
        print("nothing to migrate")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
