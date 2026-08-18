# Integration tests for POST /admin/parse_purchase_invoice_pdf
# (app/api/routes/orders.py) — specifically the status code each way of
# refusing an uploaded vendor invoice comes back as, since that is what the
# admin's upload screen branches on and what turns a rejection into a
# sentence they can act on.
#
# read_uploaded_invoice is stubbed out: the reading itself is covered by
# test_invoice_extraction.py and its matching rules by
# test_purchase_invoice_intake.py, and everything it does against Mongo is
# exactly what these tests must not need. require_admin is overridden so
# these don't depend on whether auth_enabled is set locally, same as
# test_catalogue_pdf.py.
import io
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.api.routes import orders
from app.api.routes.admin import require_admin
from app.main import app
from app.services.invoice_extraction import InvoiceExtractionError
from app.services.purchase_invoice_intake import (
    DuplicateInvoiceError,
    MatchedLineItem,
    ProductNotFoundError,
    PurchaseInvoiceIntake,
    UnsupportedInvoiceError,
    VendorNotFoundError,
)

BASE = "/api/v1/admin"

app.dependency_overrides[require_admin] = lambda: None
client = TestClient(app)


def _post():
    return client.post(
        f"{BASE}/parse_purchase_invoice_pdf",
        files={"file": ("invoice.pdf", io.BytesIO(b"%PDF-1.4 not really"), "application/pdf")},
    )


def _stub(monkeypatch, result):
    async def _read_uploaded_invoice(_pdf_bytes):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(orders, "read_uploaded_invoice", _read_uploaded_invoice)


def _intake() -> PurchaseInvoiceIntake:
    return PurchaseInvoiceIntake(
        vendor_id=4,
        vendor_name="Shah Clock Agencies",
        vendor_gstin="29ABJPN9424H1Z7",
        invoice_no="Sca/26-27/1147",
        invoice_date=datetime(2026, 4, 22),
        line_items=(
            MatchedLineItem(
                product_id=9,
                product_name="Ab80 Gym Shaker Bottle",
                description="Ab80 Gym Shaker Bottle Green",
                quantity=20,
                rate=85.0,
                gst_perc=18.0,
            ),
        ),
        sgst_perc=None,
        cgst_perc=None,
        igst_perc=18.0,
        total_amount_before_tax=1700.0,
        total_amount_after_tax=2006.0,
        printed_total=2006.0,
        total_mismatch=False,
        source="text",
    )


def test_a_read_invoice_comes_back_in_the_shape_the_order_form_submits(monkeypatch):
    _stub(monkeypatch, _intake())

    response = _post()

    assert response.status_code == 200
    body = response.json()
    assert body["vendor_id"] == 4
    assert body["vendor_invoice_no"] == "Sca/26-27/1147"
    # The parallel arrays create_new_purchase_order takes, so the form can
    # submit what it was handed without rebuilding it.
    assert (body["product_ids"], body["quantities"], body["rates"]) == ([9], [20], [85.0])
    assert body["igst_perc"] == 18.0
    assert body["source"] == "text"
    # What each invoice line was matched to, for the admin to check.
    assert body["line_items"][0]["description"] == "Ab80 Gym Shaker Bottle Green"
    assert body["line_items"][0]["product_name"] == "Ab80 Gym Shaker Bottle"


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        # The PDF itself couldn't be read in full — nothing to argue with.
        (InvoiceExtractionError("couldn't read the invoice date from this invoice"), 422),
        # A record the admin has to add before this invoice can be accepted.
        (VendorNotFoundError("no vendor with GSTIN 29ABJPN9424H1Z7"), 404),
        (ProductNotFoundError("no product matching 'Ab80 Gym Shaker Bottle'"), 404),
        # Already recorded — a re-upload, not a second purchase.
        (DuplicateInvoiceError("invoice Sca/26-27/1147 from this vendor has already been recorded"), 409),
        # Readable and matched, but not representable as one purchase order.
        (UnsupportedInvoiceError("this invoice mixes GST rates across its line items (5%, 18%)"), 400),
    ],
)
def test_every_refusal_answers_with_its_own_status_and_reason(monkeypatch, error, expected_status):
    _stub(monkeypatch, error)

    response = _post()

    assert response.status_code == expected_status
    # The message is written for the admin and is shown to them verbatim, so
    # it has to survive the trip rather than being replaced by a generic one.
    assert response.json()["detail"] == str(error)
