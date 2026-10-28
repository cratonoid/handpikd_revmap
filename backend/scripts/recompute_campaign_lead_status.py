# One-off script: a lead's Status in a campaign used to turn Sent the moment
# it was emailed from there. It now follows the ticks instead: Sent once
# every "Data present" channel on the lead is ticked in that campaign's Sent
# status, Unsent otherwise (see services/campaign_leads.py). This re-judges
# every existing campaign_leads row by that rule, so a lead that was Sent
# only because a mail went out, while its WhatsApp is still unticked, goes
# back to Unsent. Warm / Cold needs no migration; it's worked out from the
# ticks on every read.
#
# Re-running gives the same result, but it would also undo any Status set by
# hand since, which is why run_migrations.py records it and runs it once.
# Run with: venv/Scripts/python.exe scripts/recompute_campaign_lead_status.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient

from app.core.config import settings


async def main() -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]

    data_present = {
        row["_id"]: set(row.get("outreach_channels") or [])
        async for row in db["database_contacts"].find({"contact_type": "lead"}, {"outreach_channels": 1})
    }

    to_sent: list[int] = []
    to_unsent: list[int] = []
    async for row in db["campaign_leads"].find({}, {"contact_id": 1, "status": 1, "sent_channels": 1}):
        present = data_present.get(row["contact_id"], set())
        status = "sent" if present and present <= set(row.get("sent_channels") or []) else "unsent"
        if status != row.get("status"):
            (to_sent if status == "sent" else to_unsent).append(row["_id"])

    if to_sent:
        await db["campaign_leads"].update_many({"_id": {"$in": to_sent}}, {"$set": {"status": "sent"}})
    if to_unsent:
        await db["campaign_leads"].update_many({"_id": {"$in": to_unsent}}, {"$set": {"status": "unsent"}})
    print(f"campaign_leads: {len(to_sent)} row(s) -> sent, {len(to_unsent)} row(s) -> unsent")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
