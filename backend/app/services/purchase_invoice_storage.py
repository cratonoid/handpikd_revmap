# Stores uploaded vendor purchase-invoice PDFs (the original source
# document, not a regenerable render) to local disk under
# settings.purchase_invoice_root. Deliberately private, same reasoning as
# quotation_storage.py: never mounted as public static files, since vendor
# documents may carry pricing/GSTIN info, so they're only reachable through
# the authenticated routes/purchase_invoices.py endpoints. Keyed by a
# generated uuid (see storage.py's _store_image) rather than the owning
# PurchaseInvoiceDetails.id, since the upload happens before that row
# exists (see POST /admin/parse_purchase_invoice_pdf).
import uuid
from pathlib import Path

from app.core.config import settings


def _purchase_invoice_root() -> Path:
    return Path(settings.purchase_invoice_root)


def save_uploaded_pdf(pdf_bytes: bytes) -> str:
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
