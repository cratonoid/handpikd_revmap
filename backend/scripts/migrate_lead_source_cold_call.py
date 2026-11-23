# One-off script: leads gained a Source (cold call / referral / maps /
# website, see LeadSource in backend/app/models/database_contact.py). Every
# lead that existed before then is marked as a cold call.
#
# Safe to re-run: it only matches leads that have no source field at all.
# A lead saved since then always carries the field (null if never set), so a
# re-run never overwrites a source someone chose.
# Run with: venv/bin/python scripts/migrate_lead_source_cold_call.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    result = await db["database_contacts"].update_many(
        {"contact_type": "lead", "source": {"$exists": False}},
        {"$set": {"source": "cold_call"}},
    )
    print(f"database_contacts: {result.modified_count} lead(s) source -> 'cold_call'")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
