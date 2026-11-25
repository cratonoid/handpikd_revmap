# Reading a Porter delivery's progress, server-side, for the private
# tracking relay (routes/tracking.py, models/tracking_link.py).
#
# Porter's customer tracking page (porter.in/track_live_order_v2, reached
# from a porter.in/rd/<code> short link) is a Next.js page that renders the
# order into its own HTML: an `order_details` object inside the
# self.__next_f flight payload, with the status, the driver, the drop point
# and the driver's current location. The ETA comes from the same driving
# directions call Porter's page makes (website-gateway.porter.in/maps/driving).
#
# Privacy is this module's job: Porter's page also carries the pickup
# address and coordinates, the sender's and driver's phone numbers and the
# booker's name. sanitize() keeps only what a customer may see, and the
# pickup point is used for one thing only, in memory: hiding the driver's
# location while they're still close to it, since a marker sitting at the
# pickup would give its address away. Nothing else from Porter is stored,
# logged or returned.
#
# This depends on how Porter's page is built today. If they change it,
# parse_order_details returns None and the relay keeps showing the last
# status it had, marked with how old it is.
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import logging

import httpx

# httpx logs every request URL at INFO; Porter's carry the booking id and
# customer id, so they're kept out of the logs.
logging.getLogger("httpx").setLevel(logging.WARNING)

PORTER_HOSTS = ("porter.in", "www.porter.in")
_SHORT_LINK = re.compile(r"^/rd/[A-Za-z0-9_-]{4,40}/?$")
_TRACK_PAGE = re.compile(r"^(/[a-z]{2}(-[a-z]{2})?)?/track_live_order(_v2)?/?$")
MAPS_URL = "https://website-gateway.porter.in/maps/driving"
MAX_REDIRECTS = 5
TIMEOUT_SECONDS = 10
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
}
# The driver's position isn't shown until they're this far from the pickup.
PICKUP_PRIVACY_METRES = 1500

# Porter's order statuses, mapped to ours.
_STATUS = {
    "open": "searching",
    "allocated": "searching",
    "accepted": "to_pickup",
    "loading": "at_pickup",
    "live": "on_the_way",
    "unloading": "arrived",
    "ended": "delivered",
    "completed": "delivered",
    "cancelled": "cancelled",
    "rescheduled": "cancelled",
}
FINAL_STATUSES = {"delivered", "cancelled"}
# Statuses where the driver has the goods and is heading to the customer:
# the only ones whose driver location and ETA a customer sees.
_MOVING_TO_DROP = {"on_the_way", "arrived"}


class PorterError(Exception):
    """Porter couldn't be read. The message never carries Porter's data."""


@dataclass
class Snapshot:
    status: str
    driver_first_name: str | None
    vehicle_type: str | None
    vehicle_number: str | None
    driver_lat: float | None
    driver_lng: float | None
    drop_lat: float | None
    drop_lng: float | None
    eta_seconds: int | None
    fetched_at: datetime


def _is_porter_host(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and (parsed.hostname or "").lower() in PORTER_HOSTS


def is_porter_tracking_url(url: str) -> bool:
    """A Porter short tracking link, or the tracking page it leads to."""
    if not _is_porter_host(url):
        return False
    parsed = urlparse(url)
    if _SHORT_LINK.match(parsed.path):
        return True
    return bool(_TRACK_PAGE.match(parsed.path)) and "booking_id=" in parsed.query


async def resolve(client: httpx.AsyncClient, url: str) -> str:
    """Follow a short link to the tracking page, never leaving porter.in."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if _TRACK_PAGE.match(urlparse(current).path):
            return current
        response = await client.get(current, headers=_HEADERS, follow_redirects=False)
        if response.status_code not in (301, 302, 303, 307, 308):
            raise PorterError(f"short link answered {response.status_code}")
        current = urljoin(current, response.headers.get("location", ""))
        if not _is_porter_host(current):
            raise PorterError("short link points outside porter.in")
    raise PorterError("too many redirects")


def _flight_payload(html: str) -> str:
    parts = []
    for match in re.finditer(r"self\.__next_f\.push\((\[.*?\])\)</script>", html, re.S):
        try:
            chunk = json.loads(match.group(1))
        except ValueError:
            continue
        if len(chunk) > 1 and isinstance(chunk[1], str):
            parts.append(chunk[1])
    return "".join(parts)


def _balanced_object(text: str, start: int) -> str | None:
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def parse_order_details(html: str) -> dict | None:
    """Porter's order_details object from its tracking page, or None."""
    flight = _flight_payload(html)
    key = flight.find('"order_details":')
    if key < 0:
        return None
    start = flight.find("{", key)
    raw = _balanced_object(flight, start) if start >= 0 else None
    if raw is None:
        return None
    try:
        details = json.loads(raw)
    except ValueError:
        return None
    return details if isinstance(details, dict) else None


def _point(value) -> tuple[float, float] | None:
    if not isinstance(value, dict):
        return None
    lat, lng = value.get("lat"), value.get("lng")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and (lat, lng) != (0, 0):
        return float(lat), float(lng)
    return None


def distance_metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def sanitize(details: dict, now: datetime) -> Snapshot:
    """Only what the customer may see. Everything else in `details` is dropped."""
    status = _STATUS.get(str(details.get("status", "")).lower(), "unknown")
    partner = details.get("partner") if isinstance(details.get("partner"), dict) else {}
    name = str(partner.get("name") or "").strip()
    drop = _point((details.get("dropLocation") or {}).get("location"))
    driver = _point(details.get("partnerLocation"))
    pickup = _point((details.get("pickupLocation") or {}).get("location"))

    show_driver = (
        status in _MOVING_TO_DROP
        and driver is not None
        and (pickup is None or distance_metres(driver, pickup) >= PICKUP_PRIVACY_METRES)
    )
    return Snapshot(
        status=status,
        driver_first_name=name.split()[0][:30] if name and status not in ("searching", "cancelled") else None,
        vehicle_type=str(partner.get("vehicleType") or "")[:30] or None,
        vehicle_number=str(partner.get("vehicleNumber") or "")[:20] or None,
        driver_lat=driver[0] if show_driver else None,
        driver_lng=driver[1] if show_driver else None,
        drop_lat=drop[0] if drop else None,
        drop_lng=drop[1] if drop else None,
        eta_seconds=None,
        fetched_at=now,
    )


async def _eta_seconds(
    client: httpx.AsyncClient, page_url: str, driver: tuple[float, float], drop: tuple[float, float], crn: str
) -> int | None:
    try:
        response = await client.get(
            MAPS_URL,
            params={
                "origin": f"{driver[0]},{driver[1]}",
                "destination": f"{drop[0]},{drop[1]}",
                "restrictions": "tolls",
                "order_id": crn,
            },
            headers={**_HEADERS, "country": "in", "Origin": "https://porter.in", "Referer": page_url},
        )
        if response.status_code != 200:
            return None
        legs = response.json().get("legs") or []
        total = sum(int(step.get("duration") or 0) for leg in legs for step in (leg.get("steps") or []))
        return total or None
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return None


async def fetch_snapshot(client: httpx.AsyncClient, page_url: str) -> Snapshot:
    """Read the order now. Raises PorterError (with no Porter data in it)."""
    if not (_is_porter_host(page_url) and _TRACK_PAGE.match(urlparse(page_url).path)):
        raise PorterError("not a Porter tracking page")
    try:
        response = await client.get(page_url, headers=_HEADERS, follow_redirects=False)
    except httpx.HTTPError as error:
        raise PorterError(f"tracking page unreachable ({type(error).__name__})") from None
    if response.status_code != 200:
        raise PorterError(f"tracking page answered {response.status_code}")
    details = parse_order_details(response.text)
    if details is None:
        raise PorterError("tracking page had no order details (has Porter changed it?)")

    snapshot = sanitize(details, datetime.now(timezone.utc).replace(tzinfo=None))
    if snapshot.driver_lat is not None and snapshot.drop_lat is not None:
        crn = str(details.get("crn") or "")
        snapshot.eta_seconds = await _eta_seconds(
            client,
            page_url,
            (snapshot.driver_lat, snapshot.driver_lng),
            (snapshot.drop_lat, snapshot.drop_lng),
            crn,
        )
    return snapshot


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
