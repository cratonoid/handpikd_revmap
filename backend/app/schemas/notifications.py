# Request/response bodies for the admin notification bell
# (routes/notifications.py).
from datetime import datetime

from pydantic import BaseModel, Field

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


# Phone alerts (services/push.py). The fields are the browser's
# PushSubscription as PushSubscription.toJSON() gives it.
class PushPublicKeyResponse(BaseModel):
    public_key: str


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)
