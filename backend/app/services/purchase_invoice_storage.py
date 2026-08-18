# Stores uploaded vendor purchase-invoice PDFs (the original source
# document, not a regenerable render) to local disk under
# settings.purchase_invoice_root. Deliberately private: never mounted as
# public static files, since vendor documents may carry pricing/GSTIN info,
# so they're only reachable through the authenticated
# routes/purchase_invoices.py endpoints. Keyed by a
# generated uuid (see storage.py's _store_image) rather than the owning
# PurchaseInvoiceDetails.id, so replacing an invoice's PDF writes a new file
# instead of overwriting one that's still being served (see
# attach_purchase_invoice_pdf in routes/purchase_invoices.py).
import uuid
from pathlib import Path

from app.core.config import settings
from app.services.storage import LocalUploadBlockedError


def _purchase_invoice_root() -> Path:
    return Path(settings.purchase_invoice_root)


# Same split-brain guard as storage.py's _ensure_upload_allowed, and gated by
# the same ALLOW_LOCAL_MEDIA_UPLOADS flag: this project's .env points
# MONGODB_URI at the shared production database even during local dev, so an
# upload saved under a relative purchase_invoice_root would write to this
# machine's disk while recording a path only this machine can serve.
def _ensure_upload_allowed() -> None:
    if settings.allow_local_media_uploads:
        return
    if _purchase_invoice_root().is_absolute():
        return
    raise LocalUploadBlockedError(
        f"refusing to store an upload under local path '{settings.purchase_invoice_root}': "
        "MONGODB_URI may point at the shared/production database, which would record a "
        "path only this machine can serve. Point MONGODB_URI at a database "
        "that isn't shared with production, then set "
        "ALLOW_LOCAL_MEDIA_UPLOADS=true to upload locally anyway."
    )


def save_uploaded_pdf(pdf_bytes: bytes) -> str:
    _ensure_upload_allowed()

    key = f"{uuid.uuid4().hex}.pdf"
    root = _purchase_invoice_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / key).write_bytes(pdf_bytes)
    return key


def read_uploaded_pdf(key: str) -> bytes | None:
    path = _purchase_invoice_root() / key
    if not path.is_file():
        return None
    return path.read_bytes()


# Hard delete: used when a newly-uploaded PDF replaces this one (see
# attach_purchase_invoice_pdf in routes/purchase_invoices.py) — the old file
# is not recoverable afterwards. missing_ok since a record's uploaded_pdf_path
# pointing at an already-missing file shouldn't turn a replace into an error.
def delete_uploaded_pdf(key: str) -> None:
    path = _purchase_invoice_root() / key
    path.unlink(missing_ok=True)
