# Integration tests for the catalogue PDF endpoints: a PDF is staged and
# counted by upload_catalogue_pdf, its pages are then rendered one request at
# a time by get_catalogue_pdf_page, and discard_catalogue_pdf releases the
# staged file (see app/api/routes/catalogues.py and
# app/services/catalogue_pdf_staging.py for why it's split that way).
#
# None of these endpoints touch the database, so no Mongo connection is
# needed; require_admin is overridden so the tests don't depend on whether
# auth_enabled is set in the local environment.
import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.api.routes.admin import require_admin
from app.main import app
from app.services.catalogue_pdf_staging import _staging_root

BASE = "/api/v1/admin"

app.dependency_overrides[require_admin] = lambda: None
client = TestClient(app)


@pytest.fixture
def pdf_bytes() -> bytes:
    document = pymupdf.open()
    for page_number in range(3):
        document.new_page().insert_text((72, 144), f"Page {page_number + 1}", fontsize=48)
    try:
        return document.tobytes()
    finally:
        document.close()


def _staged_files() -> set[str]:
    root = _staging_root()
    return {path.name for path in root.glob("*.pdf")} if root.is_dir() else set()


def _upload(pdf: bytes):
    return client.post(
        f"{BASE}/upload_catalogue_pdf",
        files={"file": ("catalogue.pdf", io.BytesIO(pdf), "application/pdf")},
    )


def test_upload_reports_page_count_without_rendering_pages(pdf_bytes: bytes):
    response = _upload(pdf_bytes)

    assert response.status_code == 200
    body = response.json()
    assert body["page_count"] == 3
    # The pages themselves are deliberately not in this response — returning
    # all of them is what made large catalogues impossible.
    assert set(body) == {"session_id", "page_count"}

    client.post(f"{BASE}/discard_catalogue_pdf", json={"session_id": body["session_id"]})


def test_each_page_renders_as_jpeg(pdf_bytes: bytes):
    session_id = _upload(pdf_bytes).json()["session_id"]

    for page in range(3):
        response = client.get(f"{BASE}/get_catalogue_pdf_page", params={"session_id": session_id, "page": page})
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert response.content.startswith(b"\xff\xd8\xff")

    client.post(f"{BASE}/discard_catalogue_pdf", json={"session_id": session_id})


def test_discard_releases_the_staged_pdf(pdf_bytes: bytes):
    session_id = _upload(pdf_bytes).json()["session_id"]
    assert f"{session_id}.pdf" in _staged_files()

    response = client.post(f"{BASE}/discard_catalogue_pdf", json={"session_id": session_id})
    assert response.status_code == 200
    assert f"{session_id}.pdf" not in _staged_files()

    # Pages of a discarded upload are gone, and discarding twice is a no-op.
    assert client.get(f"{BASE}/get_catalogue_pdf_page", params={"session_id": session_id, "page": 0}).status_code == 404
    assert client.post(f"{BASE}/discard_catalogue_pdf", json={"session_id": session_id}).status_code == 200


def test_unreadable_pdf_is_rejected_and_leaves_nothing_staged():
    before = _staged_files()

    response = _upload(b"not a pdf at all")

    assert response.status_code == 400
    assert response.json()["detail"] == "couldn't read this PDF"
    # Regression: the failed upload used to be discarded inside the `except`
    # block, where the live traceback still held PyMuPDF's file handle open —
    # enough to make the unlink fail outright on Windows and strand the file.
    assert _staged_files() == before


def test_page_requests_reject_bad_session_ids_and_page_numbers(pdf_bytes: bytes):
    session_id = _upload(pdf_bytes).json()["session_id"]

    # Past the last page, and a session id that was never issued.
    assert client.get(f"{BASE}/get_catalogue_pdf_page", params={"session_id": session_id, "page": 3}).status_code == 404
    assert client.get(f"{BASE}/get_catalogue_pdf_page", params={"session_id": "f" * 32, "page": 0}).status_code == 404

    # A session id is only ever uuid4().hex, so anything else is refused
    # before it can be joined onto the staging directory's path.
    traversal = client.get(
        f"{BASE}/get_catalogue_pdf_page",
        params={"session_id": "../../../etc/passwd", "page": 0},
    )
    assert traversal.status_code == 404
    assert traversal.json()["detail"] == "unknown PDF upload"

    # Negative pages don't reach the renderer at all (Query(..., ge=0)).
    assert client.get(f"{BASE}/get_catalogue_pdf_page", params={"session_id": session_id, "page": -1}).status_code == 422

    client.post(f"{BASE}/discard_catalogue_pdf", json={"session_id": session_id})
