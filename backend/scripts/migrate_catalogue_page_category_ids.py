# One-off script: catalogue pages (catalogue_image_details) gained a
# category_ids list so each category a catalogue is filed under can show its
# own subset of pages (see backend/app/models/catalogue_image_details.py).
# Before that, every page was shown under every one of its catalogue's
# categories — so pages with no category_ids field get exactly that: a copy
# of their catalogue's category_ids. The storefront looks the same afterward.
# Safe to re-run: only matches pages that have no category_ids field yet.
# Run with: venv/Scripts/python.exe scripts/migrate_catalogue_page_category_ids.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    pages = db["catalogue_image_details"]

    missing = {"category_ids": {"$exists": False}}
    to_migrate = await pages.count_documents(missing)
    print(f"found {to_migrate} catalogue page(s) without category_ids")

    migrated = 0
    if to_migrate:
        async for catalogue in db["catalogue_details"].find({}, {"_id": 1, "category_ids": 1}):
            result = await pages.update_many(
                {"catalogue_id": catalogue["_id"], **missing},
                {"$set": {"category_ids": catalogue.get("category_ids") or []}},
            )
            migrated += result.modified_count

        # Pages whose catalogue no longer exists can't be shown anywhere;
        # give them the empty list so they parse and stop matching.
        orphans = await pages.update_many(missing, {"$set": {"category_ids": []}})
        print(f"migrated {migrated} page(s); {orphans.modified_count} orphaned page(s) set to []")
    else:
        print("nothing to migrate")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
