# One-off script: purchase_order_no changed from int to str (PurchaseOrders
# model, backend/app/models/purchase_orders.py) to allow free-form PO
# numbers. Existing documents still have it stored as a Mongo int32/int64 —
# this casts them to string in place so Beanie (which validates on read)
# doesn't fail loading pre-existing purchase orders. Safe to re-run: only
# matches docs where the field is still numeric.
# Run with: venv/Scripts/python.exe scripts/migrate_purchase_order_no_to_str.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db["purchase_orders"]

    to_migrate = await collection.count_documents({"purchase_order_no": {"$type": ["int", "long", "double"]}})
    print(f"found {to_migrate} purchase_orders doc(s) with a numeric purchase_order_no")

    if to_migrate:
        result = await collection.update_many(
            {"purchase_order_no": {"$type": ["int", "long", "double"]}},
            [{"$set": {"purchase_order_no": {"$toString": "$purchase_order_no"}}}],
        )
        print(f"migrated {result.modified_count} doc(s)")
    else:
        print("nothing to migrate")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
