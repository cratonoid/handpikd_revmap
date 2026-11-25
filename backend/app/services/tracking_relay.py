# Keeps every active Porter tracking link's snapshot fresh
# (models/tracking_link.py, services/porter_tracking.py). Customers only
# ever read the stored snapshot, so however many of them are watching, Porter
# is asked once per link per REFRESH_SECONDS, by this loop alone.
#
# A link stops being fetched when its delivery ends (finished: the final
# status stays visible) or when it's 24 hours old (deactivated: "link
# expired"). A failed fetch keeps the previous snapshot, whose fetched_at
# tells the customer how old it is.
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.models import TrackingLink, TrackingSnapshot, TrackingState
from app.services import porter_tracking

logger = logging.getLogger(__name__)

REFRESH_SECONDS = 20
LINK_LIFETIME = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def refresh_link(link: TrackingLink, client, now: datetime | None = None) -> None:
    now = now or _now()
    if now >= link.expires_at:
        link.state = TrackingState.deactivated
        link.deactivated_at = now
        await link.save()
        return

    link.last_attempt_at = now
    try:
        if link.page_url is None:
            link.page_url = await porter_tracking.resolve(client, link.porter_url)
        snapshot = await porter_tracking.fetch_snapshot(client, link.page_url)
    except porter_tracking.PorterError as error:
        link.last_error = str(error)[:200]
        # Only the link id and our own message: never Porter's response.
        logger.warning("tracking link %s: %s", link.id, link.last_error)
        await link.save()
        return
    except Exception as error:  # an unexpected failure must not stop the loop
        link.last_error = f"unexpected error ({type(error).__name__})"
        logger.warning("tracking link %s: %s", link.id, link.last_error)
        await link.save()
        return

    previous = link.snapshot
    if snapshot.eta_seconds is None and previous is not None and previous.eta_seconds and snapshot.driver_lat is not None:
        # Directions briefly unavailable: carry the last ETA forward, less
        # the time that's passed.
        elapsed = int((snapshot.fetched_at - previous.fetched_at).total_seconds())
        snapshot.eta_seconds = max(previous.eta_seconds - elapsed, 60)
    link.snapshot = TrackingSnapshot(**snapshot.__dict__)
    link.last_error = None
    if snapshot.status in porter_tracking.FINAL_STATUSES:
        link.state = TrackingState.finished
    await link.save()


async def refresh_all() -> None:
    links = await TrackingLink.find(TrackingLink.state == TrackingState.active).to_list()
    if not links:
        return
    async with porter_tracking.new_client() as client:
        await asyncio.gather(*(refresh_link(link, client) for link in links))


async def expire_finished(now: datetime | None = None) -> None:
    """Finished links still show their final status until their 24 hours are up."""
    now = now or _now()
    await TrackingLink.find(
        TrackingLink.state == TrackingState.finished, TrackingLink.expires_at <= now
    ).update({"$set": {"state": TrackingState.deactivated.value, "deactivated_at": now}})


async def tracking_relay_loop() -> None:
    # Started from app/main.py's lifespan. A failed round is logged and the
    # next one retries; never fatal.
    await asyncio.sleep(15)
    from app.services.backup import restore_in_progress

    while True:
        try:
            if not restore_in_progress():
                await refresh_all()
                await expire_finished()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("tracking relay round failed")
        await asyncio.sleep(REFRESH_SECONDS)
