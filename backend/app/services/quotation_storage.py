# Caches generated quotation PDFs (see app/services/quotation_pdf.py) to
# local disk under settings.quotation_root, kept outside the git-managed
# code directory in production (see docker-compose.yml) so the files survive
# `git reset --hard` deploys and rebuilds — same reasoning as
# app/services/storage.py's media_root, but never mounted as public static
# files: quotations carry customer PII/pricing, so they're only reachable
# through the authenticated routes/quotations.py endpoints.
from pathlib import Path

from app.core.config import settings


def _quotation_root() -> Path:
    return Path(settings.quotation_root)


def _quotation_path(quotation_id: int) -> Path:
    return _quotation_root() / f"{quotation_id}.pdf"


def save_quotation_pdf(quotation_id: int, pdf_bytes: bytes) -> None:
    root = _quotation_root()
    root.mkdir(parents=True, exist_ok=True)
    _quotation_path(quotation_id).write_bytes(pdf_bytes)


def delete_quotation_pdf(quotation_id: int) -> None:
    _quotation_path(quotation_id).unlink(missing_ok=True)