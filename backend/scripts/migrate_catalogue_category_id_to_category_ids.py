# One-off script: CatalogueDetails.category_id (single int FK to Category)
# was replaced with category_ids (list[int]), so a catalogue can be listed
# under several main categories at once (see
# backend/app/models/catalogue_details.py). Existing documents still have the
# old scalar category_id field — this wraps it into a single-element
# category_ids array and removes the old field, so Beanie (which validates on
# read) doesn't fail loading pre-existing catalogues. Safe to re-run: only
# matches docs that still have a category_id field.
# Run with: venv/Scripts/python.exe scripts/migrate_catalogue_category_id_to_category_ids.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    collection = db["catalogue_details"]

    to_migrate = await collection.count_documents({"category_id": {"$exists": True}})
    print(f"found {to_migrate} catalogue_details doc(s) with a category_id field")

    if to_migrate:
        # category_id: <int> -> category_ids: [<int>]
        with_value = await collection.update_many(
            {"category_id": {"$exists": True, "$ne": None}},
            [{"$set": {"category_ids": ["$category_id"]}}, {"$unset": "category_id"}],
        )
        print(f"migrated {with_value.modified_count} doc(s) with a set category_id")

        # $exists here is required: Mongo's {"category_id": None} matches BOTH
        # a stored null AND a field that's absent entirely, so without it this
        # would re-match (and re-process) the docs the update above just
        # unset category_id from.
        null_value = await collection.update_many(
            {"category_id": {"$exists": True, "$eq": None}},
            {"$set": {"category_ids": []}, "$unset": {"category_id": ""}},
        )
        print(f"migrated {null_value.modified_count} doc(s) with category_id: null")
    else:
        print("nothing to migrate")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
