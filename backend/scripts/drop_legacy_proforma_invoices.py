# One-off script: proforma invoices used to be auto-generated the instant a
# quotation was marked "accepted" (routes/quotations.py's old
# _maybe_create_proforma_invoice), snapshotting totals straight off the
# quotation with no line items of their own. That auto-generation has been
# removed — proforma invoices are now raised by hand, with their own
# ProformaInvoiceSummary line items, same as a quotation. Any pre-existing
# proforma `invoice_details` rows predate that shape (no ProformaInvoiceSummary
# rows, cust_id unset) and can't be edited/PDF'd through the new endpoints, so
# this deletes them outright — there's no way to tell "old" from "new"
# proforma rows other than "everything that existed before this migration
# ran," so this is meant to be run exactly once, right after deploying this
# change and before anyone raises a real proforma invoice by hand.
# Run with: venv/Scripts/python.exe scripts/drop_legacy_proforma_invoices.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    invoice_details = db["invoice_details"]

    result = await invoice_details.delete_many({"type": "proforma"})
    print(f"invoice_details: deleted {result.deleted_count} legacy proforma row(s)")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
