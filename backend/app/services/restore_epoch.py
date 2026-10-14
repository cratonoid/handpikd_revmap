# Ends every login that predates the most recent restore.
#
# A restore replaces the #user collection with the backup's, but the JWT
# secret lives in .env and doesn't change — so a token issued before the
# restore still verifies, and its `sub` user id may now belong to somebody
# else entirely (on a fresh server the bootstrap admin is id 1, and so is
# whoever was id 1 in the backup). Tokens issued before the restore are
# refused instead, by comparing their `iat` against the time recorded here.
#
# The time lives in the raw #app_state collection, which a restore wipes like
# any other — mark_restored rewrites it as the restore's last step. It's
# cached in memory because it's checked on every authenticated request, which
# holds since the app runs as a single backend process (docker-compose.yml).
from datetime import datetime, timezone

from app.core.db import get_db

_COLLECTION = "app_state"
_DOC_ID = "last_restore"

_restored_at: datetime | None = None


async def load_restore_epoch() -> None:
    global _restored_at
    doc = await get_db()[_COLLECTION].find_one({"_id": _DOC_ID})
    _restored_at = doc["restored_at"].replace(tzinfo=timezone.utc) if doc else None


async def mark_restored() -> None:
    global _restored_at
    now = datetime.now(timezone.utc)
    await get_db()[_COLLECTION].update_one(
        {"_id": _DOC_ID}, {"$set": {"restored_at": now.replace(tzinfo=None)}}, upsert=True
    )
    _restored_at = now


def token_predates_restore(payload: dict) -> bool:
    if _restored_at is None:
        return False
    issued_at = payload.get("iat")
    # Tokens minted before `iat` was added carry none; after a restore they
    # can't prove they're newer, so they go too.
    if issued_at is None:
        return True
    # Whole seconds on both sides: `iat` is serialized without the fraction.
    return int(issued_at) < int(_restored_at.timestamp())
