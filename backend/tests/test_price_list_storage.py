# Price list PDFs share the private purchase-invoice store under their own
# subfolder; the returned key must round-trip through read/delete unchanged.
from app.core.config import settings
from app.services import purchase_invoice_storage as storage


def test_subfolder_key_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "purchase_invoice_root", str(tmp_path))

    key = storage.save_uploaded_pdf(b"%PDF-1.7 test", subfolder="price_lists")

    assert key.startswith("price_lists/") and key.endswith(".pdf")
    assert (tmp_path / key).is_file()
    assert storage.read_uploaded_pdf(key) == b"%PDF-1.7 test"

    storage.delete_uploaded_pdf(key)
    assert storage.read_uploaded_pdf(key) is None


def test_default_key_stays_at_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "purchase_invoice_root", str(tmp_path))

    key = storage.save_uploaded_pdf(b"%PDF-1.7")

    assert "/" not in key
    assert (tmp_path / key).is_file()
