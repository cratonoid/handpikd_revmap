# Integration tests for POST /admin/parse_printing_purchase_invoice_pdf
# (app/api/routes/printing_orders.py) — the shape a read invoice comes back
# in, and the status code each way of refusing one comes back as, since that
# is what the admin's upload screen branches on.
#
# read_uploaded_printing_invoice is stubbed out: the reading itself is
# covered by test_invoice_extraction.py and the vendor-type rules by
# test_printing_purchase_orders.py, and everything it does against Mongo is
# exactly what these tests must not need. require_admin is overridden so
# these don't depend on whether auth_enabled is set locally, same as
# test_parse_purchase_invoice_route.py.
import io
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.api.routes import printing_orders
from app.api.routes.admin import require_admin
from app.main import app
from app.services.gst import TaxKind
from app.services.invoice_extraction import InvoiceExtractionError
from app.services.printing_purchase_invoice_intake import (
    DuplicateInvoiceError,
    PrintingLineItem,
    PrintingPurchaseInvoiceIntake,
    VendorNotFoundError,
    WrongVendorTypeError,
)

BASE = "/api/v1/admin"

app.dependency_overrides[require_admin] = lambda: None
client = TestClient(app)


def _post():
    return client.post(
        f"{BASE}/parse_printing_purchase_invoice_pdf",
        files={"file": ("invoice.pdf", io.BytesIO(b"%PDF-1.4 not really"), "application/pdf")},
    )


def _stub(monkeypatch, result):
    async def _read_uploaded_printing_invoice(_pdf_bytes):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(
        printing_orders, "read_uploaded_printing_invoice", _read_uploaded_printing_invoice
    )


# The real Pearl Creation bill: a print SERVICE billed against SAC 998912,
# which matches nothing in our catalogue and is not supposed to.
_SERVICE_LINE_ITEM = PrintingLineItem(
    description="Customized Print Service",
    hsn_code="998912",
    quantity=150,
    rate=20.0,
    gst_perc=18.0,
)

# The real Paramount bill: printed stickers billed as GOODS under HSN 3919.
# Printing vendors use both kinds of code, which is why the field is neither
# validated as a SAC nor used to decide anything.
_GOODS_LINE_ITEM = PrintingLineItem(
    description="Sticker Printing A3 UV",
    hsn_code="3919",
    quantity=1,
    rate=350.0,
    gst_perc=5.0,
)


def _intake(line_items=(_SERVICE_LINE_ITEM,), **overrides) -> PrintingPurchaseInvoiceIntake:
    fields = dict(
        vendor_id=7,
        vendor_name="Pearl Creation",
        vendor_gstin="29APFPM6942M1Z7",
        invoice_no="PC/2026-27/72",
        invoice_date=datetime(2026, 8, 24),
        line_items=line_items,
        tax_kind=TaxKind.igst,
        sgst_perc=None,
        cgst_perc=None,
        igst_perc=18.0,
        total_amount_before_tax=3000.0,
        total_amount_after_tax=3540.0,
        printed_total=3540.0,
        total_mismatch=False,
        source="text",
    )
    return PrintingPurchaseInvoiceIntake(**{**fields, **overrides})


def test_a_read_invoice_comes_back_in_the_shape_the_order_form_submits(monkeypatch):
    _stub(monkeypatch, _intake())

    response = _post()

    assert response.status_code == 200
    body = response.json()
    assert body["vendor_id"] == 7
    assert body["vendor_invoice_no"] == "PC/2026-27/72"
    assert body["tax_kind"] == "igst"
    assert body["igst_perc"] == 18.0
    assert body["total_amount_after_tax"] == 3540.0
    assert body["source"] == "text"


def test_every_line_comes_back_complete_and_carries_no_product(monkeypatch):
    # The whole difference from the material parse: there is nothing to
    # resolve a description against, so no line can come back unresolved and
    # none of them names a product.
    _stub(monkeypatch, _intake())

    (line_item,) = _post().json()["line_items"]

    assert line_item == {
        "description": "Customized Print Service",
        "hsn_code": "998912",
        "quantity": 150,
        "rate": 20.0,
        "gst_perc": 18.0,
    }
    assert "product_id" not in line_item
    assert "unresolved_reason" not in line_item


def test_a_mixed_rate_invoice_comes_back_with_each_line_at_its_own_rate(monkeypatch):
    # A printing bill mixes rates as freely as a material one, and no single
    # header percentage is true of it — so the heads come back on their own
    # and the rates stay on the lines.
    _stub(
        monkeypatch,
        _intake(
            line_items=(_SERVICE_LINE_ITEM, _GOODS_LINE_ITEM),
            igst_perc=None,
            total_amount_before_tax=3350.0,
            total_amount_after_tax=3907.5,
            printed_total=3907.5,
        ),
    )

    body = _post().json()

    assert [item["gst_perc"] for item in body["line_items"]] == [18.0, 5.0]
    assert body["tax_kind"] == "igst"
    assert (body["sgst_perc"], body["cgst_perc"], body["igst_perc"]) == (None, None, None)


def test_a_total_that_doesnt_tie_out_is_reported_not_refused(monkeypatch):
    # Printing bills carry freight, labour and round-off lines no line item
    # accounts for, so this is the review screen's problem, not a rejection.
    _stub(monkeypatch, _intake(printed_total=3600.0, total_mismatch=True))

    body = _post().json()

    assert body["total_mismatch"] is True
    assert body["printed_total"] == 3600.0


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        # The PDF itself couldn't be read in full — nothing to argue with.
        (InvoiceExtractionError("couldn't read the invoice date from this invoice"), 422),
        # A record the admin has to add before this invoice can be accepted.
        (VendorNotFoundError("no vendor with GSTIN 29APFPM6942M1Z7"), 404),
        # The vendor IS on file — the upload is just on the wrong tab. A 400
        # rather than a 404, since nothing is missing.
        (
            WrongVendorTypeError(
                "Hello Pen Mart is a material vendor — record this invoice under "
                "Purchase orders / Material instead"
            ),
            400,
        ),
        # Already recorded — a re-upload, not a second purchase.
        (DuplicateInvoiceError("invoice PC/2026-27/72 from this vendor has already been recorded"), 409),
    ],
)
def test_every_refusal_answers_with_its_own_status_and_reason(monkeypatch, error, expected_status):
    _stub(monkeypatch, error)

    response = _post()

    assert response.status_code == expected_status
    # The message is written for the admin and is shown to them verbatim, so
    # it has to survive the trip rather than being replaced by a generic one.
    assert response.json()["detail"] == str(error)
