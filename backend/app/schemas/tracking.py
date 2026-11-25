# Request/response bodies for the Porter tracking relay (routes/tracking.py).
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.tracking_link import TrackingState


# --- Admin --------------------------------------------------------------
class CreateTrackingLinkRequest(BaseModel):
    porter_url: str = Field(min_length=1, max_length=500)
    label: str | None = Field(default=None, max_length=100)


class TrackingLinkIdRequest(BaseModel):
    link_id: str = Field(min_length=1, max_length=64)


class TrackingLinkItem(BaseModel):
    link_id: str
    porter_url: str
    label: str | None
    state: TrackingState
    status: str | None
    last_updated: datetime | None
    last_error: str | None
    created_at: datetime
    expires_at: datetime


# --- Customer (public) ----------------------------------------------------
# Everything a customer's page receives. Deliberately not built from the
# stored link: nothing about Porter, the sender or the pickup is in here.
class TrackPoint(BaseModel):
    lat: float
    lng: float


class TrackResponse(BaseModel):
    status: str
    finished: bool
    driver_first_name: str | None
    vehicle_type: str | None
    vehicle_number: str | None
    driver: TrackPoint | None
    drop: TrackPoint | None
    eta_seconds: int | None
    last_updated: datetime  # naive UTC
