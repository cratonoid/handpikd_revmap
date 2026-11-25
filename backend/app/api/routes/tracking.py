# The private Porter tracking relay.
#
#   - router (/admin/tracking/...): the Tracking section. Paste a Porter
#     tracking link, get a /track/<id> link to share with the customer;
#     list, deactivate and delete them.
#   - public_router (/track/<id>): what the customer's page polls. No login,
#     rate limited per visitor, and it only ever returns the sanitized
#     snapshot (models/tracking_link.py): never the Porter link, the pickup
#     or the sender.
#
# Porter itself is only ever contacted by services/tracking_relay.py's loop
# (and once when a link is created), never because a customer asked.
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps import require_section
from app.models import Section, TrackingLink, TrackingState, User
from app.schemas.tracking import (
    CreateTrackingLinkRequest,
    TrackingLinkIdRequest,
    TrackingLinkItem,
    TrackPoint,
    TrackResponse,
)
from app.services import porter_tracking
from app.services.rate_limit import RateLimiter
from app.services.tracking_relay import LINK_LIFETIME, refresh_link

router = APIRouter(prefix="/admin/tracking", tags=["tracking"])
public_router = APIRouter(prefix="/track", tags=["tracking-public"])

_require_tracking = require_section(Section.tracking)

EXPIRED = "This tracking link has expired."
# A customer's page polls every 15 seconds; this leaves room for a few open
# tabs and reloads, and stops anyone sweeping ids.
_limiter = RateLimiter(limit=20, window_seconds=60)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _item(link: TrackingLink) -> TrackingLinkItem:
    return TrackingLinkItem(
        link_id=link.id,
        porter_url=link.porter_url,
        label=link.label,
        state=link.state,
        status=link.snapshot.status if link.snapshot else None,
        last_updated=link.snapshot.fetched_at if link.snapshot else None,
        last_error=link.last_error,
        created_at=link.created_at,
        expires_at=link.expires_at,
    )


async def _get_link_or_404(link_id: str) -> TrackingLink:
    link = await TrackingLink.get(link_id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="tracking link not found")
    return link


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
@router.get("/get_links", response_model=list[TrackingLinkItem])
async def get_links(_: User | None = Depends(_require_tracking)) -> list[TrackingLinkItem]:
    links = await TrackingLink.find_all().sort(-TrackingLink.created_at).limit(200).to_list()
    return [_item(link) for link in links]


@router.post("/create_link", response_model=TrackingLinkItem)
async def create_link(
    payload: CreateTrackingLinkRequest,
    current_user: User | None = Depends(_require_tracking),
) -> TrackingLinkItem:
    porter_url = payload.porter_url.strip()
    if not porter_tracking.is_porter_tracking_url(porter_url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="that isn't a Porter tracking link: paste the porter.in/rd/… link Porter sent",
        )
    now = _now()
    link = TrackingLink(
        id=secrets.token_urlsafe(16),
        porter_url=porter_url,
        label=(payload.label or "").strip() or None,
        created_by_user_id=current_user.id if current_user else None,
        created_at=now,
        expires_at=now + LINK_LIFETIME,
    )
    await link.insert()
    # A first read straight away, so the list shows whether it works. A
    # failure here isn't fatal: the relay loop keeps trying.
    async with porter_tracking.new_client() as client:
        await refresh_link(link, client, now)
    return _item(link)


@router.post("/deactivate_link", response_model=TrackingLinkItem)
async def deactivate_link(
    payload: TrackingLinkIdRequest,
    _: User | None = Depends(_require_tracking),
) -> TrackingLinkItem:
    link = await _get_link_or_404(payload.link_id)
    if link.state != TrackingState.deactivated:
        link.state = TrackingState.deactivated
        link.deactivated_at = _now()
        await link.save()
    return _item(link)


@router.post("/delete_link")
async def delete_link(
    payload: TrackingLinkIdRequest,
    _: User | None = Depends(_require_tracking),
) -> dict:
    link = await _get_link_or_404(payload.link_id)
    await link.delete()
    return {"message": "tracking link deleted"}


# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------
def _client_ip(request: Request) -> str:
    # nginx (deploy/nginx.conf) sets X-Real-IP to the visitor's address.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


@public_router.get("/{link_id}", response_model=TrackResponse)
async def get_tracking(link_id: str, request: Request, response: Response) -> TrackResponse:
    if not _limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many requests, slow down")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"

    link = await TrackingLink.get(link_id) if 10 <= len(link_id) <= 64 else None
    if (
        link is None
        or link.state == TrackingState.deactivated
        or _now() >= link.expires_at
        or link.snapshot is None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EXPIRED)

    snap = link.snapshot
    return TrackResponse(
        status=snap.status,
        finished=link.state == TrackingState.finished,
        driver_first_name=snap.driver_first_name,
        vehicle_type=snap.vehicle_type,
        vehicle_number=snap.vehicle_number,
        driver=TrackPoint(lat=snap.driver_lat, lng=snap.driver_lng) if snap.driver_lat is not None else None,
        drop=TrackPoint(lat=snap.drop_lat, lng=snap.drop_lng) if snap.drop_lat is not None else None,
        eta_seconds=snap.eta_seconds,
        last_updated=snap.fetched_at,
    )
