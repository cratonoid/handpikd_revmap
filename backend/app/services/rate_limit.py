# A small in-memory sliding-window rate limiter for public endpoints (the
# Porter tracking relay's /track API). In memory is enough: the backend runs
# as one process (see the Dockerfile's single uvicorn worker), and losing
# the counts on a restart only resets everyone's allowance.
import time
from collections import deque


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._last_sweep = 0.0

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        cutoff = now - self.window
        if now - self._last_sweep > self.window:
            # Forget callers who've gone quiet, so the table can't grow forever.
            self._hits = {k: q for k, q in self._hits.items() if q and q[-1] > cutoff}
            self._last_sweep = now
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True
