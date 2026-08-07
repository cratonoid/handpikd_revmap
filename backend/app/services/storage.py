# Saves product images to local disk and returns a path served by the
# FastAPI StaticFiles mount (see app/main.py) at /media. Kept as a relative
# path (not a full URL) so it resolves against whatever's fronting the API —
# nginx proxies /media/ straight through to the backend in production (see
# deploy/nginx.conf), and the frontend prefixes it with the backend's own
# origin in local dev (see frontend/src/lib/api.ts's resolveMediaUrl).
import uuid
from pathlib import Path

from app.core.config import settings

MEDIA_URL_PREFIX = "/media"


def _media_root() -> Path:
    return Path(settings.media_root)


def upload_product_image(image_bytes: bytes, filename: str) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"{uuid.uuid4().hex}.{extension}"

    media_root = _media_root()
    media_root.mkdir(parents=True, exist_ok=True)
    (media_root / key).write_bytes(image_bytes)

    return f"{MEDIA_URL_PREFIX}/{key}"


def delete_product_image(image_path: str) -> None:
    filename = image_path.rsplit("/", 1)[-1]
    (_media_root() / filename).unlink(missing_ok=True)
