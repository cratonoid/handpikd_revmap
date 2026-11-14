# Schema for the #notification collection: one event someone should know
# about ("a client raised a ticket", "the team replied to your ticket"),
# shown in the bell on the admin panel and on the client portal
# (frontend/src/components/admin/notification-bell.tsx).
#
# Deliberately knows nothing about tickets or any other module. A producer
# calls services/notifications.py's notify() with a kind, some text and a
# link, and that's the whole contract — so a new kind of notification is one
# notify() call in the module it belongs to, not a change here.
#
# Who sees it is decided by `section`: a team member sees a notification only
# if their role grants that section (the same rule require_section enforces),
# so a role without Tickets isn't told about tickets. `recipient_user_id`
# narrows it further to one person, for notifications aimed at somebody
# specific (an assignment, a mention); None means everyone with the section.
#
# A notification for a client is one with recipient_user_id set to the
# client's login. The portal shows a client only the notifications addressed
# to them, never the team's broadcasts, and no team member is ever that
# recipient (one User collection, so ids don't collide). `section` then names
# the module it came from.
#
# Read state lives in #notification_read, one row per (notification, user),
# rather than as a list on this document — a notification shown to the whole
# team would otherwise grow a new array entry for every reader.
from datetime import datetime

from beanie import Document
from pymongo import DESCENDING, IndexModel

from app.models.role import Section


class Notification(Document):
    id: int
    # A dotted, producer-owned identifier such as "ticket.raised". Free text
    # rather than an Enum so adding a kind doesn't touch this module; the
    # frontend only uses it to pick an icon and falls back to a generic one.
    kind: str
    title: str
    body: str = ""
    # Where clicking it goes, as a path on the reader's side of the app
    # ("/admin/tickets?ticket=12", "/customer/tickets?ticket=12").
    link: str = ""
    section: Section
    recipient_user_id: int | None = None
    created_at: datetime  # naive UTC

    class Settings:
        name = "notification"
        indexes = [IndexModel([("section", 1), ("created_at", DESCENDING)])]
