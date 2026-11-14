# The notification module: the one way anything in the app tells the team,
# or a client, that something happened, and the queries behind both bells.
#
# Producers only ever call notify(). It records the event and returns; it
# doesn't know who is signed in, how the bell renders, or whether a
# notification will one day also go out by email or push. Those are this
# module's concern, which is what lets delivery grow later without touching
# the producers. A new channel (email, web push, a websocket) is just another
# step inside notify(), or a worker reading #notification.
#
# notify() never raises. A notification is a side effect of something that
# already happened (a ticket was raised), and failing to record it must not
# fail the request that did the real work.
import logging
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from app.models import Notification, NotificationIdCounter, NotificationRead, Section, User
from app.services.counters import get_next_id

logger = logging.getLogger(__name__)

# Read state is keyed on a user id. With settings.auth_enabled off the admin
# screens have no User at all, so they share this stand-in id, which no real
# account uses (ids start at 1).
LOCAL_ADMIN_USER_ID = 0


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def notify(
    kind: str,
    title: str,
    section: Section,
    body: str = "",
    link: str = "",
    recipient_user_id: int | None = None,
) -> Notification | None:
    """Record a notification for every team member who can open `section`.

    `kind` is a dotted name the producer owns ("ticket.raised"). Pass
    `recipient_user_id` to show it to one person only, which is also how a
    client is notified (pass their login's id). Returns the stored
    notification, or None if it couldn't be stored (logged, never raised).
    """
    try:
        notification_id = await get_next_id(NotificationIdCounter, "next_notification_id", Notification)
        notification = Notification(
            id=notification_id,
            kind=kind,
            title=title,
            body=body,
            link=link,
            section=section,
            recipient_user_id=recipient_user_id,
            created_at=_now(),
        )
        await notification.insert()
        return notification
    except Exception:
        logger.exception("failed to record %s notification", kind)
        return None


def reader_id(user: User | None) -> int:
    return user.id if user is not None else LOCAL_ADMIN_USER_ID


def visible_filter(user_id: int, allowed_sections: set[Section] | None) -> dict:
    """The raw Mongo filter for the notifications `user_id` may see.

    `allowed_sections` is api/deps.py's get_allowed_sections result, where
    None means every section (the Administrator role).
    """
    conditions: list[dict] = [{"$or": [{"recipient_user_id": None}, {"recipient_user_id": user_id}]}]
    if allowed_sections is not None:
        conditions.append({"section": {"$in": [section.value for section in allowed_sections]}})
    return {"$and": conditions}


def client_filter(user_id: int) -> dict:
    """The raw Mongo filter for what a client login sees: only what is
    addressed to them, never the team's section-wide broadcasts."""
    return {"recipient_user_id": user_id}


# The three queries below take the reader's filter (visible_filter for a team
# member, client_filter for a client) rather than building it, so the same
# code serves both bells.
async def list_for_user(user_id: int, query: dict, limit: int) -> tuple[list[Notification], set[int]]:
    """The newest `limit` notifications matching `query`, and which are read."""
    notifications = (
        await Notification.find(query)
        .sort(-Notification.created_at, -Notification.id)
        .limit(limit)
        .to_list()
    )
    ids = [notification.id for notification in notifications]
    reads = await NotificationRead.find(
        {"user_id": user_id, "notification_id": {"$in": ids}}
    ).to_list() if ids else []
    return notifications, {read.notification_id for read in reads}


async def unread_count(user_id: int, query: dict) -> int:
    # One aggregation instead of loading every read row this user has ever
    # made: the $lookup is served by notification_read's (user_id,
    # notification_id) index.
    collection = Notification.get_pymongo_collection()
    read_collection = NotificationRead.get_pymongo_collection().name
    cursor = await collection.aggregate(
        [
            {"$match": query},
            {
                "$lookup": {
                    "from": read_collection,
                    "let": {"nid": "$_id"},
                    "pipeline": [
                        {"$match": {"user_id": user_id}},
                        {"$match": {"$expr": {"$eq": ["$notification_id", "$$nid"]}}},
                        {"$limit": 1},
                    ],
                    "as": "reads",
                }
            },
            {"$match": {"reads": {"$size": 0}}},
            {"$count": "unread"},
        ]
    )
    rows = await cursor.to_list(length=1)
    return rows[0]["unread"] if rows else 0


async def mark_read(user_id: int, notification_ids: list[int]) -> None:
    now = _now()
    for notification_id in set(notification_ids):
        try:
            await NotificationRead(notification_id=notification_id, user_id=user_id, read_at=now).insert()
        except DuplicateKeyError:
            # Already read, maybe from another tab. Nothing to do.
            pass


async def mark_all_read(user_id: int, query: dict) -> None:
    collection = Notification.get_pymongo_collection()
    ids = [doc["_id"] async for doc in collection.find(query, {"_id": 1})]
    if not ids:
        return
    already = {
        read.notification_id
        for read in await NotificationRead.find({"user_id": user_id, "notification_id": {"$in": ids}}).to_list()
    }
    await mark_read(user_id, [notification_id for notification_id in ids if notification_id not in already])
