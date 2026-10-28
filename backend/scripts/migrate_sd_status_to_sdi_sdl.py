# One-off script: SD Status was cut from four values to two. "sdid" and
# "sdld" are gone, leaving sdi / sdl (see SdStatus in
# backend/app/models/database_contact.py), so each retired value is folded
# into the one it extended: sdid -> sdi, sdld -> sdl. Beanie validates on
# read, so without this any campaign_leads row (or old database_contacts row)
# still holding a retired value fails to parse and the campaign page 500s.
#
# Safe to re-run: it only matches documents still carrying a retired value.
# Run with: venv/Scripts/python.exe scripts/migrate_sd_status_to_sdi_sdl.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

_RETIRED = {"sdid": "sdi", "sdld": "sdl"}
_COLLECTIONS = ["campaign_leads", "database_contacts"]


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    for name in _COLLECTIONS:
        collection = db[name]
        for old, new in _RETIRED.items():
            result = await collection.update_many({"sd_status": old}, {"$set": {"sd_status": new}})
            print(f"{name}: {result.modified_count} doc(s) sd_status {old!r} -> {new!r}")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
