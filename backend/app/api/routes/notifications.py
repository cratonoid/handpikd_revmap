# The admin panel's notification bell: what the signed-in team member has
# been notified about, how much is unread, and marking things read. All of
# the logic is in services/notifications.py; this is only the HTTP surface.
#
# Open to every team account (require_staff), because what each person sees
# is already filtered to the sections their role grants. A notification about
# a section they can't open never reaches them.
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_allowed_sections, require_staff
from app.models import User
from app.schemas.notifications import (
    MarkNotificationsReadRequest,
    NotificationItem,
    NotificationListResponse,
    UnreadCountResponse,
)
from app.services import notifications as service

router = APIRouter(prefix="/admin/notifications", tags=["notifications"])


async def _sections(user: User | None):
    # No user means auth is disabled locally: everything is visible.
    return await get_allowed_sections(user) if user is not None else None


@router.get("/get_notifications", response_model=NotificationListResponse)
async def get_notifications(
    limit: int = Query(20, ge=1, le=100),
    current_user: User | None = Depends(require_staff),
) -> NotificationListResponse:
    user_id = service.reader_id(current_user)
    sections = await _sections(current_user)
    notifications, read_ids = await service.list_for_user(user_id, sections, limit)
    return NotificationListResponse(
        items=[
            NotificationItem(
                id=notification.id,
                kind=notification.kind,
                title=notification.title,
                body=notification.body,
                link=notification.link,
                section=notification.section,
                created_at=notification.created_at,
                is_read=notification.id in read_ids,
            )
            for notification in notifications
        ],
        unread_count=await service.unread_count(user_id, sections),
    )


@router.get("/get_unread_count", response_model=UnreadCountResponse)
async def get_unread_count(current_user: User | None = Depends(require_staff)) -> UnreadCountResponse:
    # What the bell polls: cheap enough to ask every half minute.
    return UnreadCountResponse(
        unread_count=await service.unread_count(service.reader_id(current_user), await _sections(current_user))
    )


@router.post("/mark_notifications_read", response_model=UnreadCountResponse)
async def mark_notifications_read(
    payload: MarkNotificationsReadRequest,
    current_user: User | None = Depends(require_staff),
) -> UnreadCountResponse:
    user_id = service.reader_id(current_user)
    await service.mark_read(user_id, payload.notification_ids)
    return UnreadCountResponse(unread_count=await service.unread_count(user_id, await _sections(current_user)))


@router.post("/mark_all_notifications_read", response_model=UnreadCountResponse)
async def mark_all_notifications_read(current_user: User | None = Depends(require_staff)) -> UnreadCountResponse:
    user_id = service.reader_id(current_user)
    sections = await _sections(current_user)
    await service.mark_all_read(user_id, sections)
    return UnreadCountResponse(unread_count=await service.unread_count(user_id, sections))
