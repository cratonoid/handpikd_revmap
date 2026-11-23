# Phone alerts: Web Push to the installed admin app (frontend/public/sw.js).
#
# A team member turns alerts on once per phone; the browser hands us a
# subscription (models/push_subscription.py) and from then on send_push
# reaches that phone even when the app is closed. Pushes are signed with the
# site's VAPID key pair, generated on first use and kept in #push_settings.
#
# Like notify(), send_push never raises: an alert is a side effect, and a
# push service being down must not fail whatever triggered it.
import asyncio
import base64
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pymongo.errors import DuplicateKeyError
from pywebpush import WebPushException, webpush

from app.models import PushSettings, PushSubscription

logger = logging.getLogger(__name__)

# Who to contact about this sender; push services require one.
VAPID_SUBJECT = "https://handpikd.co"
# How long a push service keeps trying an offline phone.
PUSH_TTL_SECONDS = 12 * 60 * 60

_vapid: Vapid | None = None
_public_key: str | None = None
_key_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _public_key_of(vapid: Vapid) -> str:
    raw = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def _keys() -> tuple[Vapid, str]:
    global _vapid, _public_key
    if _vapid is not None and _public_key is not None:
        return _vapid, _public_key
    async with _key_lock:
        if _vapid is None or _public_key is None:
            row = await PushSettings.get(1)
            if row is None:
                vapid = Vapid()
                vapid.generate_keys()
                row = PushSettings(
                    id=1,
                    private_key_pem=vapid.private_pem().decode(),
                    public_key=_public_key_of(vapid),
                )
                try:
                    await row.insert()
                except DuplicateKeyError:
                    # Another worker generated it first: use theirs.
                    row = await PushSettings.get(1)
            _vapid = Vapid.from_pem(row.private_key_pem.encode())
            _public_key = row.public_key
    return _vapid, _public_key


async def public_key() -> str:
    _, key = await _keys()
    return key


# The server POSTs to whatever endpoint a phone registered, so only the real
# browser push services are accepted: never an arbitrary URL.
PUSH_SERVICE_HOSTS = (
    "fcm.googleapis.com",  # Chrome, Edge, Android
    "push.services.mozilla.com",  # Firefox
    "push.apple.com",  # Safari / iPhone (web.push.apple.com)
    "notify.windows.com",  # older Edge
)


def is_push_service(endpoint: str) -> bool:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_SERVICE_HOSTS)


async def subscribe(user_id: int, endpoint: str, p256dh: str, auth: str) -> None:
    existing = await PushSubscription.find_one(PushSubscription.endpoint == endpoint)
    if existing is not None:
        # Same phone, maybe now signed in as someone else.
        existing.user_id = user_id
        existing.p256dh = p256dh
        existing.auth = auth
        await existing.save()
        return
    try:
        await PushSubscription(
            endpoint=endpoint, p256dh=p256dh, auth=auth, user_id=user_id, created_at=_now()
        ).insert()
    except DuplicateKeyError:
        pass  # a double tap raced us; the first insert is the same row


async def unsubscribe(endpoint: str) -> None:
    await PushSubscription.find(PushSubscription.endpoint == endpoint).delete()


def _send_one(subscription: PushSubscription, payload: str, vapid: Vapid) -> int | None:
    """Runs in a worker thread (pywebpush is blocking). Returns the push
    service's error status, or None if it was accepted."""
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=payload,
            vapid_private_key=vapid,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=PUSH_TTL_SECONDS,
            timeout=10,
        )
        return None
    except WebPushException as error:
        return error.response.status_code if error.response is not None else 0


async def send_push(user_id: int, title: str, body: str = "", link: str = "") -> int:
    """Push to every phone `user_id` has alerts on for. Returns how many
    accepted it. Never raises."""
    try:
        subscriptions = await PushSubscription.find(PushSubscription.user_id == user_id).to_list()
        if not subscriptions:
            return 0
        vapid, _ = await _keys()
        payload = json.dumps({"title": title, "body": body, "link": link or "/admin"})
        sent = 0
        for subscription in subscriptions:
            failure = await asyncio.to_thread(_send_one, subscription, payload, vapid)
            if failure is None:
                sent += 1
            elif failure in (404, 410):
                # The phone dropped this subscription; stop trying it.
                await subscription.delete()
            else:
                logger.warning("push to user %s failed with status %s", user_id, failure)
        return sent
    except Exception:
        logger.exception("push to user %s failed", user_id)
        return 0


# Pushes started by notify() run in the background so the request that
# caused them doesn't wait on a push service. Held here so they aren't
# garbage collected mid-send.
_background: set[asyncio.Task] = set()


def send_push_in_background(user_id: int, title: str, body: str = "", link: str = "") -> None:
    task = asyncio.create_task(send_push(user_id, title, body, link))
    _background.add(task)
    task.add_done_callback(_background.discard)
