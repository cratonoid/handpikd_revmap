# One-off script: Work board stories gained a group (models/work_group.py).
# Every story that existed before then goes into a "General" group whose
# members are all active team accounts, so nobody loses sight of a story.
#
# Safe to re-run: it only touches stories with no group_id field at all, and
# reuses the "General" group if an earlier run created it.
# Run with: venv/bin/python scripts/migrate_work_story_groups.py
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings

GENERAL = "General"


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    ungrouped = {"group_id": {"$exists": False}}
    if await db["work_story"].count_documents(ungrouped) == 0:
        print("work_story: nothing to move")
        await client.close()
        return

    group = await db["work_group"].find_one({"name": GENERAL})
    if group is None:
        last = await db["work_group"].find_one(sort=[("_id", -1)])
        members = [user["_id"] async for user in db["user"].find({"role": "admin", "is_active": True}, {"_id": 1})]
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        group = {
            "_id": (last["_id"] + 1) if last else 1,
            "name": GENERAL,
            "member_user_ids": sorted(members),
            "created_at": now,
            "updated_at": now,
        }
        await db["work_group"].insert_one(group)
        print(f"work_group: created {GENERAL!r} (#{group['_id']}) with {len(members)} member(s)")

    result = await db["work_story"].update_many(ungrouped, {"$set": {"group_id": group["_id"]}})
    print(f"work_story: {result.modified_count} story(ies) -> group {GENERAL!r}")
    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
