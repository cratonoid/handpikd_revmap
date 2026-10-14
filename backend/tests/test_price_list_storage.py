# Price list files share the private purchase-invoice store under their own
# subfolder; the returned key must round-trip through read/delete unchanged.
# And since a price list may be a PDF or an Excel workbook, the type is read
# from the bytes — a renamed file of some other kind must be refused.
import io
import zipfile

from app.api.routes.price_lists import detect_price_list_file_type
from app.core.config import settings
from app.services import purchase_invoice_storage as storage


def test_subfolder_key_round_trips(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "purchase_invoice_root", str(tmp_path))

    key = storage.save_uploaded_file(b"%PDF-1.7 test", "xlsx", subfolder="price_lists")

    assert key.startswith("price_lists/") and key.endswith(".xlsx")
    assert (tmp_path / key).is_file()
    assert storage.read_uploaded_pdf(key) == b"%PDF-1.7 test"

    storage.delete_uploaded_pdf(key)
    assert storage.read_uploaded_pdf(key) is None


def test_invoice_pdf_key_stays_at_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "purchase_invoice_root", str(tmp_path))

    key = storage.save_uploaded_pdf(b"%PDF-1.7")

    assert "/" not in key and key.endswith(".pdf")
    assert (tmp_path / key).is_file()


def _zip_with(*names: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, "x")
    return buffer.getvalue()


OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64


def test_pdf_is_detected_whatever_its_name():
    assert detect_price_list_file_type(b"%PDF-1.4 ...", "prices.pdf") == "pdf"
    assert detect_price_list_file_type(b"%PDF-1.4 ...", "prices") == "pdf"


def test_xlsx_is_a_zip_holding_a_workbook():
    assert detect_price_list_file_type(_zip_with("xl/workbook.xml", "[Content_Types].xml"), "rates.xlsx") == "xlsx"


def test_other_zips_are_refused():
    # A Word document (or any zip) renamed to .xlsx isn't a workbook.
    assert detect_price_list_file_type(_zip_with("word/document.xml"), "rates.xlsx") is None
    assert detect_price_list_file_type(b"PK\x03\x04 not really a zip", "rates.xlsx") is None


def test_xls_needs_its_signature_and_extension():
    assert detect_price_list_file_type(OLE2, "rates.xls") == "xls"
    assert detect_price_list_file_type(OLE2, "RATES.XLS") == "xls"
    # Same OLE2 container as an old .doc, so the name has to agree.
    assert detect_price_list_file_type(OLE2, "letter.doc") is None


def test_unknown_content_is_refused():
    assert detect_price_list_file_type(b"name,price\nmug,120\n", "rates.csv") is None
    assert detect_price_list_file_type(b"", "rates.pdf") is None
