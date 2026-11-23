# Schema for the #push_subscription collection: one row per phone/browser a
# team member has turned phone alerts on for (services/push.py). The
# endpoint, p256dh and auth values come straight from the browser's
# PushSubscription; a push is sent to every row a user has.
#
# A row is removed when the push service says the subscription is gone (404
# or 410), which is what happens after the app is uninstalled or alerts are
# switched off in the phone's settings.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel


class PushSubscription(Document):
    # Mongo's own ObjectId _id: rows are looked up by endpoint or user_id.
    endpoint: str
    p256dh: str
    auth: str
    user_id: int  # FK -> User.id (a team account)
    created_at: datetime  # naive UTC

    class Settings:
        name = "push_subscription"
        indexes = [
            IndexModel([("endpoint", 1)], unique=True),
            IndexModel([("user_id", 1)]),
        ]
