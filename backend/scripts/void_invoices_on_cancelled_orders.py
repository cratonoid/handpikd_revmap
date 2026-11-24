# One-off script: cancelling a sales order has voided its unpaid invoices
# automatically since 2026-11-07 (void_unpaid_invoices_for_sales_order in
# app/services/invoice_totals.py). Orders cancelled before that kept their
# invoices live and unpaid, so they still counted as money owed on the
# dashboard and in accounts receivables. In production that was one invoice,
# H/26-27/40 on Areva Paints' SO-41.
#
# This applies the same rule to them after the fact: every live, unpaid
# standard invoice that lists a cancelled order is voided, and marked
# voided_by_cancellation exactly as the app would have, so un-cancelling the
# order brings it back. Paid invoices are left alone, as the app leaves them.
#
# Safe to re-run: it only matches invoices still live and unpaid on a
# cancelled order, which is a state the app no longer produces.
# Run with: venv/Scripts/python.exe scripts/void_invoices_on_cancelled_orders.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    try:
        cancelled_status = await db["order_status_master"].find_one({"status_name": "Cancelled"})
        if cancelled_status is None:
            print("no Cancelled order status seeded - nothing to do")
            return
        cancelled_ids = [
            doc["_id"]
            async for doc in db["sales_orders"].find({"order_status_id": cancelled_status["_id"]}, {"_id": 1})
        ]
        if not cancelled_ids:
            print("no cancelled sales orders - nothing to do")
            return

        query = {
            "type": "standard",
            "is_deleted": False,
            "status": "unpaid",
            "state": {"$ne": "draft"},
            "sales_ids": {"$in": cancelled_ids},
        }
        found = [doc["_id"] async for doc in db["invoice_details"].find(query, {"_id": 1})]
        print(f"found {len(found)} live unpaid invoice(s) on cancelled sales orders: {found}")
        if found:
            result = await db["invoice_details"].update_many(
                query, {"$set": {"is_deleted": True, "voided_by_cancellation": True}}
            )
            print(f"voided {result.modified_count} invoice(s)")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
