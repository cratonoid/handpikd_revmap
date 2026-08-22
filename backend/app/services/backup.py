# Builds a single zip that captures every Mongo collection plus every
# locally-stored upload (product/catalogue/signature images under
# settings.media_root, vendor purchase-invoice PDFs under
# settings.purchase_invoice_root) — a full point-in-time export of "all the
# data", for GET /admin/get_backup_zip (see routes/admin.py). Layout:
#   manifest.json              generated_at + per-collection/file counts
#   db/<collection_name>.json  every document in that collection, as a raw
#                               JSON array — read straight off each model's
#                               pymongo collection (get_pymongo_collection(),
#                               same bypass services/counters.py already
#                               relies on) rather than through Beanie's
#                               validated find_all(), since the *_id_counter
#                               collections store a plain int _id that
#                               doesn't match their Document class's default
#                               ObjectId id field and would fail validation.
#   media/...                  settings.media_root, paths preserved as-is
#   purchase_invoices/...      settings.purchase_invoice_root, same
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId

from app.core.config import settings
from app.core.db import DOCUMENT_MODELS

DB_ENTRY_PREFIX = "db"
MEDIA_ENTRY_PREFIX = "media"
PURCHASE_INVOICE_ENTRY_PREFIX = "purchase_invoices"


def _json_default(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


async def _dump_collections(archive: zipfile.ZipFile) -> dict[str, int]:
    counts: dict[str, int] = {}
    for model in DOCUMENT_MODELS:
        name = model.get_settings().name
        documents = await model.get_pymongo_collection().find().to_list(length=None)
        counts[name] = len(documents)
        archive.writestr(f"{DB_ENTRY_PREFIX}/{name}.json", json.dumps(documents, indent=2, default=_json_default))
    return counts


def _add_directory(archive: zipfile.ZipFile, root: Path, entry_prefix: str) -> int:
    if not root.is_dir():
        return 0
    file_count = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        arcname = f"{entry_prefix}/{path.relative_to(root).as_posix()}"
        archive.write(path, arcname)
        file_count += 1
    return file_count


async def build_backup_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        collection_counts = await _dump_collections(archive)
        media_file_count = _add_directory(archive, Path(settings.media_root), MEDIA_ENTRY_PREFIX)
        purchase_invoice_file_count = _add_directory(
            archive, Path(settings.purchase_invoice_root), PURCHASE_INVOICE_ENTRY_PREFIX
        )

        manifest = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "app_name": settings.app_name,
            "collections": collection_counts,
            "media_file_count": media_file_count,
            "purchase_invoice_file_count": purchase_invoice_file_count,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))

    return buffer.getvalue()
