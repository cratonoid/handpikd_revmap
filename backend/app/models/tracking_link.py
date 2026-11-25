# Schema for the #tracking_link collection: the private Porter tracking
# relay (routes/tracking.py). The admin pastes a Porter tracking link and
# gets back /track/<id> to share with the customer, who sees the delivery's
# progress without the pickup address or anything else about the sender.
#
# porter_url and page_url are admin-only and never leave the admin API.
# `snapshot` is the only thing a customer is ever shown, and holds only
# what services/porter_tracking.sanitize() keeps.
from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import BaseModel


class TrackingState(str, Enum):
    active = "active"  # fetched from Porter every few seconds
    finished = "finished"  # delivered or cancelled: final status still shown
    deactivated = "deactivated"  # by hand, or 24 hours on: "link expired"


class TrackingSnapshot(BaseModel):
    status: str
    driver_first_name: str | None = None
    vehicle_type: str | None = None
    vehicle_number: str | None = None
    driver_lat: float | None = None
    driver_lng: float | None = None
    drop_lat: float | None = None
    drop_lng: float | None = None
    eta_seconds: int | None = None
    fetched_at: datetime  # naive UTC


class TrackingLink(Document):
    # Random and unguessable (secrets.token_urlsafe): it's the customer's
    # only key to the page.
    id: str
    porter_url: str  # what the admin pasted
    page_url: str | None = None  # the tracking page it leads to, once resolved
    label: str | None = None  # the admin's own note, e.g. the customer's name
    state: TrackingState = TrackingState.active
    snapshot: TrackingSnapshot | None = None
    last_error: str | None = None  # short, never Porter's data
    last_attempt_at: datetime | None = None  # naive UTC
    created_by_user_id: int | None = None
    created_at: datetime  # naive UTC
    expires_at: datetime  # naive UTC
    deactivated_at: datetime | None = None

    class Settings:
        name = "tracking_link"
