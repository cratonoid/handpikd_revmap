# Saves uploaded images to local disk and returns a path served by the
# FastAPI StaticFiles mount (see app/main.py) at /media. Kept as a relative
# path (not a full URL) so it resolves against whatever's fronting the API —
# nginx proxies /media/ straight through to the backend in production (see
# deploy/nginx.conf), and the frontend prefixes it with the backend's own
# origin in local dev (see frontend/src/lib/api.ts's resolveMediaUrl).
import uuid
from pathlib import Path

from app.core.config import settings

MEDIA_URL_PREFIX = "/media"

# Catalogue page images live in their own subfolder, separate from product
# images — they're converted PDF pages (see services/pdf.py) rather than
# admin-picked product photos, and keeping them apart makes each folder's
# contents easier to reason about/clean up independently.
CATALOGUE_IMAGE_SUBFOLDER = "catalogues"


class LocalUploadBlockedError(RuntimeError):
    """Raised by _store_image when media_root is a local dev path.

    See settings.allow_local_media_uploads for why this exists — routes
    should catch this and turn it into an HTTPException.
    """


def _media_root() -> Path:
    return Path(settings.media_root)


def _ensure_upload_allowed() -> None:
    if settings.allow_local_media_uploads:
        return
    if _media_root().is_absolute():
        return
    raise LocalUploadBlockedError(
        f"refusing to store an upload under local path '{settings.media_root}': "
        "MEDIA_ROOT is still the local-dev relative default, but MONGODB_URI "
        "may point at the shared/production database, which would record a "
        "path only this machine can serve. Point MONGODB_URI at a database "
        "that isn't shared with production, then set "
        "ALLOW_LOCAL_MEDIA_UPLOADS=true to upload locally anyway."
    )


def _store_image(image_bytes: bytes, filename: str, subfolder: str = "") -> str:
    _ensure_upload_allowed()

    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"{uuid.uuid4().hex}.{extension}"

    directory = _media_root() / subfolder if subfolder else _media_root()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / key).write_bytes(image_bytes)

    url_path = f"{subfolder}/{key}" if subfolder else key
    return f"{MEDIA_URL_PREFIX}/{url_path}"


def _delete_image(image_path: str) -> None:
    # Strip the "/media/" prefix (rather than just the trailing filename) so
    # this still resolves correctly for images stored under a subfolder, e.g.
    # "/media/catalogues/<uuid>.png" -> media_root/catalogues/<uuid>.png.
    relative = image_path.removeprefix(f"{MEDIA_URL_PREFIX}/")
    (_media_root() / relative).unlink(missing_ok=True)


def upload_product_image(image_bytes: bytes, filename: str) -> str:
    return _store_image(image_bytes, filename)


def delete_product_image(image_path: str) -> None:
    _delete_image(image_path)


def upload_catalogue_image(image_bytes: bytes, filename: str) -> str:
    return _store_image(image_bytes, filename, subfolder=CATALOGUE_IMAGE_SUBFOLDER)


def delete_catalogue_image(image_path: str) -> None:
    _delete_image(image_path)


# The company's own signature scan, embedded on offline invoices (see
# services/invoice_pdf.py) instead of the "system generated, no signature
# required" disclaimer. Stored under its own subfolder rather than loose in
# media_root, same organizing convention as CATALOGUE_IMAGE_SUBFOLDER.
SIGNATURE_IMAGE_SUBFOLDER = "signatures"


def upload_signature_image(image_bytes: bytes, filename: str) -> str:
    return _store_image(image_bytes, filename, subfolder=SIGNATURE_IMAGE_SUBFOLDER)
