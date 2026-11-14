# Schema for the #notification_read collection: "this user has read this
# notification" (see models/notification.py for why it's a collection of its
# own). Its absence is what makes a notification unread for someone.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel


class NotificationRead(Document):
    # Mongo's own ObjectId _id: nothing ever looks a read row up by id, so it
    # needs no counter of its own.
    notification_id: int  # FK -> Notification.id
    user_id: int  # FK -> User.id (0 for the auth-disabled local admin)
    read_at: datetime  # naive UTC

    class Settings:
        name = "notification_read"
        indexes = [IndexModel([("user_id", 1), ("notification_id", 1)], unique=True)]
