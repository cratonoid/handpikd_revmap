# Unit tests for the private Porter tracking relay: reading Porter's page
# (services/porter_tracking.py), what reaches the customer (routes/tracking.py),
# the refresh loop's state changes (services/tracking_relay.py) and the rate
# limiter. The Porter page below is synthetic (made-up people and places),
# shaped like the real one: order_details inside the Next.js flight payload.
import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.api.routes import tracking as routes
from app.models.tracking_link import TrackingSnapshot, TrackingState
from app.services import porter_tracking, tracking_relay
from app.services.rate_limit import RateLimiter

_NOW = datetime(2026, 11, 25, 10, 0)
PICKUP = {"lat": 12.9700, "lng": 77.5900}
DROP = {"lat": 12.9300, "lng": 77.6100}
FAR_FROM_PICKUP = {"lat": 12.9450, "lng": 77.6000}  # ~3 km on


def _page(status="live", partner_location=FAR_FROM_PICKUP) -> str:
    details = {
        "status": status,
        "crn": "CRN000000000001",
        "partner": {"name": "Ravi Kumar", "mobile": "9000000001", "vehicleType": "Scooter", "vehicleNumber": "KA01AB1234"},
        "pickupLocation": {"landmark": "Sender's Warehouse, 1 Secret Street", "location": PICKUP},
        "dropLocation": {"landmark": "Customer Home", "location": DROP},
        "partnerLocation": partner_location,
        "customerSupportContact": "1800000000",
        "customerInfo": {"name": "Sender Person", "number": "9000000002"},
    }
    flight = '5:["$","div",null,{"order_details":' + json.dumps(details) + ',"channel_uuid":{"channel_uuid":"x"}}]'
    half = len(flight) // 2
    pushes = "".join(
        f"<script>self.__next_f.push({json.dumps([1, part])})</script>" for part in (flight[:half], flight[half:])
    )
    return f"<html><body>{pushes}</body></html>"


# --- reading Porter -----------------------------------------------------------
def test_only_customer_safe_fields_survive():
    snapshot = porter_tracking.sanitize(porter_tracking.parse_order_details(_page()), _NOW)

    assert snapshot.status == "on_the_way"
    assert (snapshot.driver_first_name, snapshot.vehicle_number) == ("Ravi", "KA01AB1234")
    assert (snapshot.driver_lat, snapshot.drop_lat) == (FAR_FROM_PICKUP["lat"], DROP["lat"])
    leaked = json.dumps(snapshot.__dict__, default=str)
    for secret in ("Secret Street", "9000000001", "9000000002", "Sender Person", "1800000000", "CRN", "12.97"):
        assert secret not in leaked


def test_driver_near_the_pickup_is_hidden():
    near = {"lat": PICKUP["lat"] + 0.001, "lng": PICKUP["lng"]}
    snapshot = porter_tracking.sanitize(porter_tracking.parse_order_details(_page(partner_location=near)), _NOW)
    assert snapshot.driver_lat is None and snapshot.drop_lat is not None


def test_driver_heading_to_pickup_is_hidden():
    snapshot = porter_tracking.sanitize(porter_tracking.parse_order_details(_page(status="accepted")), _NOW)
    assert (snapshot.status, snapshot.driver_lat) == ("to_pickup", None)


def test_a_changed_page_parses_to_nothing():
    assert porter_tracking.parse_order_details("<html>no data</html>") is None


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://porter.in/rd/5aa2c0da31", True),
        ("https://porter.in/track_live_order_v2?booking_id=CRN1&customer_uuid=x", True),
        ("http://porter.in/rd/5aa2c0da31", False),
        ("https://porter.in.evil.example/rd/5aa2c0da31", False),
        ("https://evil.example/rd/5aa2c0da31", False),
        ("https://porter.in/about", False),
    ],
)
def test_only_porter_tracking_links_are_accepted(url, ok):
    assert porter_tracking.is_porter_tracking_url(url) is ok


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_short_links_resolve_but_never_leave_porter():
    def to_page(request):
        return httpx.Response(302, headers={"location": "/track_live_order_v2?booking_id=CRN1&customer_uuid=u"})

    def to_elsewhere(request):
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest"})

    async def go(handler):
        async with _client(handler) as client:
            return await porter_tracking.resolve(client, "https://porter.in/rd/abcdef")

    assert asyncio.run(go(to_page)) == "https://porter.in/track_live_order_v2?booking_id=CRN1&customer_uuid=u"
    with pytest.raises(porter_tracking.PorterError):
        asyncio.run(go(to_elsewhere))


def test_eta_comes_from_porters_directions():
    def handler(request):
        if request.url.path == "/maps/driving":
            return httpx.Response(200, json={"legs": [{"steps": [{"duration": 300}, {"duration": 420}]}]})
        return httpx.Response(200, text=_page())

    async def go():
        async with _client(handler) as client:
            return await porter_tracking.fetch_snapshot(client, "https://porter.in/track_live_order_v2?booking_id=1")

    assert asyncio.run(go()).eta_seconds == 720


# --- the refresh loop -----------------------------------------------------------
def _link(**overrides):
    link = SimpleNamespace(
        id="abcdefghijklmnop",
        porter_url="https://porter.in/rd/abcdef",
        page_url="https://porter.in/track_live_order_v2?booking_id=1",
        state=TrackingState.active,
        snapshot=None,
        last_error=None,
        last_attempt_at=None,
        deactivated_at=None,
        expires_at=_NOW + timedelta(hours=1),
        saved=0,
    )
    for key, value in overrides.items():
        setattr(link, key, value)

    async def save():
        link.saved += 1

    link.save = save
    return link


def _snapshot(status="on_the_way", **overrides) -> porter_tracking.Snapshot:
    values = dict(
        status=status,
        driver_first_name="Ravi",
        vehicle_type="Scooter",
        vehicle_number="KA01AB1234",
        driver_lat=12.94,
        driver_lng=77.60,
        drop_lat=12.93,
        drop_lng=77.61,
        eta_seconds=600,
        fetched_at=_NOW,
    )
    values.update(overrides)
    return porter_tracking.Snapshot(**values)


def _porter_returns(monkeypatch, result):
    async def fake_fetch(client, page_url):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(porter_tracking, "fetch_snapshot", fake_fetch)


def test_a_delivered_order_finishes_the_link(monkeypatch):
    link = _link()
    _porter_returns(monkeypatch, _snapshot("delivered"))
    asyncio.run(tracking_relay.refresh_link(link, None, _NOW))
    assert (link.state, link.snapshot.status) == (TrackingState.finished, "delivered")


def test_a_failed_fetch_keeps_the_last_snapshot(monkeypatch):
    before = TrackingSnapshot(**_snapshot().__dict__)
    link = _link(snapshot=before)
    _porter_returns(monkeypatch, porter_tracking.PorterError("tracking page answered 503"))
    asyncio.run(tracking_relay.refresh_link(link, None, _NOW + timedelta(minutes=1)))
    assert link.snapshot is before
    assert link.last_error == "tracking page answered 503"
    assert link.state == TrackingState.active


def test_a_link_expires_after_its_24_hours(monkeypatch):
    link = _link(expires_at=_NOW)
    _porter_returns(monkeypatch, AssertionError("Porter must not be asked"))
    asyncio.run(tracking_relay.refresh_link(link, None, _NOW))
    assert link.state == TrackingState.deactivated


# --- what the customer gets -------------------------------------------------------
def _request(ip="10.0.0.1"):
    return SimpleNamespace(headers={"x-real-ip": ip}, client=None)


def _serve(monkeypatch, link):
    class _Links:
        @staticmethod
        async def get(link_id):
            return link if link and link_id == link.id else None

    monkeypatch.setattr(routes, "TrackingLink", _Links)
    monkeypatch.setattr(routes, "_now", lambda: _NOW)
    monkeypatch.setattr(routes, "_limiter", RateLimiter(limit=100, window_seconds=60))


def test_the_customer_gets_no_porter_link(monkeypatch):
    link = _link(snapshot=TrackingSnapshot(**_snapshot().__dict__))
    _serve(monkeypatch, link)

    response = asyncio.run(routes.get_tracking(link.id, _request(), SimpleNamespace(headers={})))

    body = response.model_dump_json()
    assert "porter" not in body.lower() and "booking_id" not in body
    assert response.driver.lat == 12.94 and response.eta_seconds == 600


@pytest.mark.parametrize("state", [TrackingState.deactivated])
def test_a_deactivated_link_has_expired(monkeypatch, state):
    link = _link(state=state, snapshot=TrackingSnapshot(**_snapshot().__dict__))
    _serve(monkeypatch, link)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.get_tracking(link.id, _request(), SimpleNamespace(headers={})))
    assert (error.value.status_code, error.value.detail) == (404, routes.EXPIRED)


def test_an_unknown_link_has_expired(monkeypatch):
    _serve(monkeypatch, None)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.get_tracking("nope-nope-nope-nope", _request(), SimpleNamespace(headers={})))
    assert error.value.status_code == 404


def test_the_track_api_is_rate_limited(monkeypatch):
    link = _link(snapshot=TrackingSnapshot(**_snapshot().__dict__))
    _serve(monkeypatch, link)
    monkeypatch.setattr(routes, "_limiter", RateLimiter(limit=2, window_seconds=60))

    for _ in range(2):
        asyncio.run(routes.get_tracking(link.id, _request(), SimpleNamespace(headers={})))
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.get_tracking(link.id, _request(), SimpleNamespace(headers={})))
    assert error.value.status_code == 429
    # Someone else isn't affected.
    asyncio.run(routes.get_tracking(link.id, _request("10.0.0.2"), SimpleNamespace(headers={})))


def test_rate_limiter_window_slides():
    limiter = RateLimiter(limit=1, window_seconds=10)
    assert limiter.allow("a", now=0) and not limiter.allow("a", now=5) and limiter.allow("a", now=10.5)
