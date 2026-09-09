# One-off script: InvoiceDetails.status was cut from three values to two.
# "new" (raised) and "submitted" (sent to the client) both meant the same
# thing to the books — money still owed — so they are now the single value
# "unpaid", leaving the enum as unpaid/paid (see
# backend/app/models/invoice_details.py). Existing documents still store the
# old values; Beanie validates on read, so without this every pre-existing
# invoice fails to parse and any endpoint that lists invoices 500s.
#
# "paid" is unchanged and is deliberately not touched. Safe to re-run: it
# only matches documents still carrying one of the two retired values.
# Run with: venv/Scripts/python.exe scripts/migrate_invoice_status_to_unpaid_paid.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

# The retired values, both of which meant "not yet settled".
_RETIRED_STATUSES = ["new", "submitted"]


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db["invoice_details"]

    query = {"status": {"$in": _RETIRED_STATUSES}}
    to_migrate = await collection.count_documents(query)
    print(f"found {to_migrate} invoice_details doc(s) with a retired status")

    if to_migrate:
        result = await collection.update_many(query, {"$set": {"status": "unpaid"}})
        print(f"migrated {result.modified_count} doc(s) to status 'unpaid'")
    else:
        print("nothing to migrate")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
