# One-off script: the standard (tax) invoice series became scoped to the
# Indian financial year — H/26-27/12, the twelfth tax invoice of FY 2026-27,
# restarting at 1 every 1 April (see app/services/invoice_numbering.py). Two
# things have to be true before that code path goes live:
#
#   1. Every existing standard invoice_details row carries the financial year
#      its number belongs to (invoice_fy_start_year), derived from its own
#      invoice date. The formatter falls back to deriving it from `date`
#      when the field is missing, but `date` is editable, so leaving it
#      unset means a later date correction silently renumbers an invoice
#      that has already gone out.
#
#   2. standard_invoice_no_counter_master stops being the single running
#      counter at _id=1 and becomes one document per financial year, keyed by
#      the year that financial year starts in (_id=2026 for FY 2026-27). Each
#      year's counter is seeded from the highest invoice_no already issued in
#      that year, NOT from 1 — the old counter was continuous across years, so
#      FY 2026-27 may well already hold invoice_no 41..47, and restarting at 1
#      would hand out numbers that are already on issued invoices. Nothing is
#      renumbered: the existing rows keep the numbers they were issued with,
#      and the current year simply continues from its own high-water mark.
#      Years with no invoices get no document and so start at 1 on their own.
#
# Run this BEFORE the FY-scoped code path serves traffic. If new code raises
# an invoice first, that year's counter is created at 1 by the upsert in
# get_next_scoped_id and can collide with a legacy number in the same year.
#
# Safe to re-run: the backfill matches only rows still missing the field, and
# a year's counter is seeded only if it doesn't exist yet, so a counter that
# has since advanced is never pushed back.
#
# Run with: venv/Scripts/python.exe scripts/migrate_standard_invoice_no_to_fy_series.py
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

_LEGACY_COUNTER_DOC_ID = 1
_COUNTER_COLLECTION = "standard_invoice_no_counter_master"


def _financial_year_start_year(when: date | datetime) -> int:
    # Same rule as app/services/invoice_numbering.financial_year_start_year,
    # restated here so the migration keeps working unchanged if that module
    # is later refactored — migrations are historical records, not live code.
    return when.year if when.month >= 4 else when.year - 1


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    invoice_details = db["invoice_details"]
    counters = db[_COUNTER_COLLECTION]

    backfilled = 0
    async for doc in invoice_details.find(
        {"type": "standard", "invoice_fy_start_year": {"$exists": False}}
    ):
        fy_start_year = _financial_year_start_year(doc["date"])
        await invoice_details.update_one(
            {"_id": doc["_id"]}, {"$set": {"invoice_fy_start_year": fy_start_year}}
        )
        backfilled += 1
    print(f"invoice_details: backfilled invoice_fy_start_year on {backfilled} standard row(s)")

    highest_by_fy: dict[int, int] = {}
    async for doc in invoice_details.find({"type": "standard"}, {"date": 1, "invoice_no": 1}):
        fy_start_year = _financial_year_start_year(doc["date"])
        invoice_no = doc.get("invoice_no", 0)
        if invoice_no > highest_by_fy.get(fy_start_year, 0):
            highest_by_fy[fy_start_year] = invoice_no

    for fy_start_year in sorted(highest_by_fy):
        label = f"{fy_start_year % 100:02d}-{(fy_start_year + 1) % 100:02d}"
        existing = await counters.find_one({"_id": fy_start_year})
        if existing is not None:
            print(
                f"{_COUNTER_COLLECTION}: FY {label} already seeded "
                f"(next_invoice_no={existing['next_invoice_no']}), skipping"
            )
            continue

        highest = highest_by_fy[fy_start_year]
        await counters.insert_one({"_id": fy_start_year, "next_invoice_no": highest})
        print(f"{_COUNTER_COLLECTION}: FY {label} seeded next_invoice_no={highest}")

    # The old continuous counter is now dead weight, and leaving it makes the
    # collection read as if there were a year whose key is 1.
    deleted = await counters.delete_one({"_id": _LEGACY_COUNTER_DOC_ID})
    print(
        f"{_COUNTER_COLLECTION}: legacy running counter (_id={_LEGACY_COUNTER_DOC_ID}) "
        f"{'removed' if deleted.deleted_count else 'already gone'}"
    )

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
