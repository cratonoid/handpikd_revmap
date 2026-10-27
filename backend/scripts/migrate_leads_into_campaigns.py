# One-off script: leads used to carry their outreach on their own Database
# row (lead_status, sd_status, sent_channels), because campaigns didn't
# exist yet. Now each campaign has its own lead list with those columns per
# lead (models/campaign_lead.py). This puts the leads we already had into
# the campaigns they were really worked in, copying those three values:
#
#   - Leads from FIRST through LAST (by when they were added; default
#     "Eneffen" through "Rupifi") -> the "Diwali 2026" campaign.
#   - Every lead added after LAST -> the "Christmas and New Year" campaign.
#
# Each campaign is created if no campaign of that name exists yet. Leads a
# campaign that already existed has emailed are added to it as well (Sent,
# with Mail ticked, if the email was delivered), so its page doesn't lose them.
#
# MANUAL in scripts/run_migrations.py: which leads go where is a judgement
# call by name, so it must be read before it's applied. Without --apply it
# only prints what it would do. Re-running is safe: a lead already in a
# campaign is left as it is.
#
# Run with:  venv/Scripts/python.exe scripts/migrate_leads_into_campaigns.py
#            venv/Scripts/python.exe scripts/migrate_leads_into_campaigns.py --apply
# Production: docker compose run --rm backend python scripts/migrate_leads_into_campaigns.py [--apply]
import argparse
import asyncio
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import AsyncMongoClient, ReturnDocument

from app.core.config import settings

DIWALI_NAME = "Diwali 2026"
CHRISTMAS_NAME = "Christmas and New Year"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _find_one(leads: list[dict], name: str) -> dict:
    wanted = name.strip().lower()
    matches = [lead for lead in leads if (lead.get("name") or "").strip().lower() == wanted]
    if not matches:
        matches = [lead for lead in leads if wanted in (lead.get("name") or "").lower()]
    if len(matches) != 1:
        found = ", ".join(f'#{lead["_id"]} "{lead.get("name")}"' for lead in matches) or "none"
        raise SystemExit(f'expected exactly one lead named "{name}", found: {found}')
    return matches[0]


def _describe(lead: dict) -> str:
    return f'#{lead["_id"]} {lead.get("name")!r} (added {str(lead.get("created_at"))[:10]})'


async def _reserve_ids(db, counter: str, field: str, target: str, count: int) -> list[int]:
    # Same counters services/counters.py get_next_id uses, whose document
    # holds the last id handed out; a block of `count` is taken at once.
    if count == 0:
        return []
    updated = await db[counter].find_one_and_update(
        {"_id": 1}, {"$inc": {field: count}}, return_document=ReturnDocument.AFTER
    )
    if updated is None:
        last = await db[target].find_one({}, sort=[("_id", -1)], projection={"_id": 1})
        base = last["_id"] if last else 0
        await db[counter].insert_one({"_id": 1, field: base + count})
        top = base + count
    else:
        top = updated[field]
    return list(range(top - count + 1, top + 1))


async def _campaign_id(db, name: str, apply: bool) -> int | None:
    existing = await db.campaigns.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if existing:
        print(f'campaign "{name}": exists (#{existing["_id"]})')
        return existing["_id"]
    print(f'campaign "{name}": will be created')
    if not apply:
        return None
    [new_id] = await _reserve_ids(db, "campaign_id_counter", "next_campaign_id", "campaigns", 1)
    now = _now()
    await db.campaigns.insert_one({"_id": new_id, "name": name, "description": None, "created_at": now, "updated_at": now})
    return new_id


def _row(campaign_id: int, lead: dict) -> dict:
    return {
        "campaign_id": campaign_id,
        "contact_id": lead["_id"],
        "status": "sent" if lead.get("lead_status") == "sent" else "unsent",
        "sd_status": lead.get("sd_status"),
        "sent_channels": list(lead.get("sent_channels") or []),
        "added_at": _now(),
    }


async def _insert_rows(db, rows: list[dict], apply: bool) -> int:
    pairs = [{"campaign_id": row["campaign_id"], "contact_id": row["contact_id"]} for row in rows]
    taken = set()
    if pairs:
        async for doc in db.campaign_leads.find({"$or": pairs}, {"campaign_id": 1, "contact_id": 1}):
            taken.add((doc["campaign_id"], doc["contact_id"]))
    new_rows, seen = [], set()
    for row in rows:
        key = (row["campaign_id"], row["contact_id"])
        if key in taken or key in seen:
            continue
        seen.add(key)
        new_rows.append(row)
    if apply and new_rows:
        ids = await _reserve_ids(db, "campaign_lead_id_counter", "next_campaign_lead_id", "campaign_leads", len(new_rows))
        for row, row_id in zip(new_rows, ids):
            row["_id"] = row_id
        await db.campaign_leads.insert_many(new_rows)
    return len(new_rows)


async def main(first: str = "Eneffen", last: str = "Rupifi", apply: bool = False) -> None:
    client = AsyncMongoClient(settings.mongodb_uri)
    db = client[settings.mongodb_db_name]
    try:
        print(f"database: {settings.mongodb_db_name} ({'APPLYING' if apply else 'dry run - nothing is written'})\n")
        leads = await db.database_contacts.find({"contact_type": "lead"}).sort("_id", 1).to_list()
        start, end = _find_one(leads, first), _find_one(leads, last)
        # Ids follow the order leads were added in, so "from FIRST through
        # LAST" is an id range, whichever of the two was added first.
        low, high = sorted((start["_id"], end["_id"]))
        diwali = [lead for lead in leads if low <= lead["_id"] <= high]
        if start["_id"] <= end["_id"]:
            after = [lead for lead in leads if lead["_id"] > high]
            before = [lead for lead in leads if lead["_id"] < low]
        else:
            after = [lead for lead in leads if lead["_id"] < low]
            before = [lead for lead in leads if lead["_id"] > high]

        print(f"{len(leads)} leads in the Database")
        print(f"  {DIWALI_NAME}: {len(diwali)} leads, {_describe(start)} through {_describe(end)}")
        if after:
            print(f"  {CHRISTMAS_NAME}: {len(after)} leads, {_describe(after[0])} ... {_describe(after[-1])}")
        else:
            print(f"  {CHRISTMAS_NAME}: no leads after {last}")
        if before:
            print(f"  NOT PLACED: {len(before)} lead(s) on the far side of {first}:")
            for lead in before:
                print(f"    {_describe(lead)}")
        print()

        diwali_id = await _campaign_id(db, DIWALI_NAME, apply)
        christmas_id = await _campaign_id(db, CHRISTMAS_NAME, apply)

        rows: list[dict] = []
        if diwali_id is not None or not apply:
            rows += [_row(diwali_id or -1, lead) for lead in diwali]
        if christmas_id is not None or not apply:
            rows += [_row(christmas_id or -2, lead) for lead in after]

        # Campaigns that already sent mail keep the leads they emailed.
        lead_ids = {lead["_id"] for lead in leads}
        sent_rows: dict[tuple[int, int], dict] = {}
        async for send in db.email_sends.find({"campaign_id": {"$ne": None}}).sort("_id", 1):
            for recipient in send.get("recipients", []):
                contact_id = recipient.get("contact_id")
                if contact_id not in lead_ids:
                    continue
                key = (send["campaign_id"], contact_id)
                row = sent_rows.setdefault(
                    key,
                    {"campaign_id": key[0], "contact_id": contact_id, "status": "unsent",
                     "sd_status": None, "sent_channels": [], "added_at": _now()},
                )
                if recipient.get("status") == "sent":
                    row["status"], row["sent_channels"] = "sent", ["mail"]
        if sent_rows:
            print(f"{len(sent_rows)} lead(s) emailed by existing campaigns, kept in those campaigns")

        added = await _insert_rows(db, list(sent_rows.values()) + rows, apply)
        print(f"\n{'added' if apply else 'would add'} {added} campaign lead row(s)")
        if not apply:
            print("re-run with --apply to write this")
    finally:
        await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Put existing leads into the Diwali and Christmas campaigns.")
    parser.add_argument("--first", default="Eneffen", help="first lead of the Diwali campaign")
    parser.add_argument("--last", default="Rupifi", help="last lead of the Diwali campaign")
    parser.add_argument("--apply", action="store_true", help="write the changes (default is a dry run)")
    args = parser.parse_args()
    asyncio.run(main(args.first, args.last, args.apply))
