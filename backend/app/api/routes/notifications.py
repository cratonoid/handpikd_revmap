# The notification bells: what the reader has been notified about, how much
# is unread, and marking things read. All of the logic is in
# services/notifications.py; this is only the HTTP surface, twice over:
#
#   - router (/admin/notifications/...) for any team account (require_staff).
#     What each person sees is already filtered to the sections their role
#     grants, so a notification about a section they can't open never
#     reaches them.
#   - customer_router (/customer/...) for a client login
#     (require_customer_account). A client sees only the notifications
#     addressed to their own login.
#
# Both sides return the same shapes, so the frontend's bell is one component
# pointed at one set of endpoints or the other.
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_allowed_sections, require_staff
from app.api.routes.customer_invoices import require_customer_account
from app.models import CustomerDetails, Notification, User
from app.schemas.notifications import (
    MarkNotificationsReadRequest,
    NotificationItem,
    NotificationListResponse,
    UnreadCountResponse,
)
from app.services import notifications as service

router = APIRouter(prefix="/admin/notifications", tags=["notifications"])

customer_router = APIRouter(prefix="/customer", tags=["customer-notifications"])

# (reader's user id, Mongo filter for what they may see)
Reader = tuple[int, dict]


async def _team_reader(current_user: User | None = Depends(require_staff)) -> Reader:
    # No user means auth is disabled locally: everything is visible.
    sections = await get_allowed_sections(current_user) if current_user is not None else None
    user_id = service.reader_id(current_user)
    return user_id, service.visible_filter(user_id, sections)


async def _client_reader(customer: CustomerDetails = Depends(require_customer_account)) -> Reader:
    return customer.user_id, service.client_filter(customer.user_id)


def _item(notification: Notification, read_ids: set[int]) -> NotificationItem:
    return NotificationItem(
        id=notification.id,
        kind=notification.kind,
        title=notification.title,
        body=notification.body,
        link=notification.link,
        section=notification.section,
        created_at=notification.created_at,
        is_read=notification.id in read_ids,
    )


async def _list(reader: Reader, limit: int) -> NotificationListResponse:
    user_id, query = reader
    notifications, read_ids = await service.list_for_user(user_id, query, limit)
    return NotificationListResponse(
        items=[_item(notification, read_ids) for notification in notifications],
        unread_count=await service.unread_count(user_id, query),
    )


async def _count(reader: Reader) -> UnreadCountResponse:
    user_id, query = reader
    return UnreadCountResponse(unread_count=await service.unread_count(user_id, query))


async def _mark(reader: Reader, notification_ids: list[int]) -> UnreadCountResponse:
    await service.mark_read(reader[0], notification_ids)
    return await _count(reader)


async def _mark_all(reader: Reader) -> UnreadCountResponse:
    await service.mark_all_read(*reader)
    return await _count(reader)


# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------
@router.get("/get_notifications", response_model=NotificationListResponse)
async def get_notifications(
    limit: int = Query(20, ge=1, le=100), reader: Reader = Depends(_team_reader)
) -> NotificationListResponse:
    return await _list(reader, limit)


@router.get("/get_unread_count", response_model=UnreadCountResponse)
async def get_unread_count(reader: Reader = Depends(_team_reader)) -> UnreadCountResponse:
    # What the bell polls: cheap enough to ask every half minute.
    return await _count(reader)


@router.post("/mark_notifications_read", response_model=UnreadCountResponse)
async def mark_notifications_read(
    payload: MarkNotificationsReadRequest, reader: Reader = Depends(_team_reader)
) -> UnreadCountResponse:
    return await _mark(reader, payload.notification_ids)


@router.post("/mark_all_notifications_read", response_model=UnreadCountResponse)
async def mark_all_notifications_read(reader: Reader = Depends(_team_reader)) -> UnreadCountResponse:
    return await _mark_all(reader)


# ---------------------------------------------------------------------------
# Client portal
# ---------------------------------------------------------------------------
@customer_router.get("/get_my_notifications", response_model=NotificationListResponse)
async def get_my_notifications(
    limit: int = Query(20, ge=1, le=100), reader: Reader = Depends(_client_reader)
) -> NotificationListResponse:
    return await _list(reader, limit)


@customer_router.get("/get_my_unread_notification_count", response_model=UnreadCountResponse)
async def get_my_unread_notification_count(reader: Reader = Depends(_client_reader)) -> UnreadCountResponse:
    return await _count(reader)


@customer_router.post("/mark_my_notifications_read", response_model=UnreadCountResponse)
async def mark_my_notifications_read(
    payload: MarkNotificationsReadRequest, reader: Reader = Depends(_client_reader)
) -> UnreadCountResponse:
    return await _mark(reader, payload.notification_ids)


@customer_router.post("/mark_all_my_notifications_read", response_model=UnreadCountResponse)
async def mark_all_my_notifications_read(reader: Reader = Depends(_client_reader)) -> UnreadCountResponse:
    return await _mark_all(reader)
