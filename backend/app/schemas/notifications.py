# Request/response bodies for the admin notification bell
# (routes/notifications.py).
from datetime import datetime

from pydantic import BaseModel

from app.models.role import Section


class NotificationItem(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    link: str
    section: Section
    created_at: datetime  # naive UTC
    is_read: bool


class NotificationListResponse(BaseModel):
    items: list[NotificationItem]
    # Across every visible notification, not just the ones in `items`.
    unread_count: int


class UnreadCountResponse(BaseModel):
    unread_count: int


class MarkNotificationsReadRequest(BaseModel):
    notification_ids: list[int]
