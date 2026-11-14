# Schema for the #notification_id_counter collection.
from beanie import Document


class NotificationIdCounter(Document):
    id: int
    next_notification_id: int

    class Settings:
        name = "notification_id_counter"
