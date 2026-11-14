# Schema for the #notification collection: one event the team should know
# about ("a client raised a ticket"), shown in the admin panel's bell
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
    # Where clicking it goes, as an admin path ("/admin/tickets?ticket=12").
    link: str = ""
    section: Section
    recipient_user_id: int | None = None
    created_at: datetime  # naive UTC

    class Settings:
        name = "notification"
        indexes = [IndexModel([("section", 1), ("created_at", DESCENDING)])]
