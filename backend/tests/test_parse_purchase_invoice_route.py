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
from app.services.gst import TaxKind
from app.services.purchase_invoice_intake import (
    DuplicateInvoiceError,
    MatchedLineItem,
    PurchaseInvoiceIntake,
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


_MATCHED_LINE_ITEM = MatchedLineItem(
    product_id=9,
    product_name="Ab80 Gym Shaker Bottle",
    description="Ab80 Gym Shaker Bottle Green",
    hsn_code="39249090",
    quantity=20,
    rate=85.0,
    gst_perc=18.0,
)

# What a line whose description didn't resolve to one of the vendor's
# products comes back as — not an error, a question for the review screen.
_UNRESOLVED_LINE_ITEM = MatchedLineItem(
    product_id=None,
    product_name=None,
    description="BALL PEN",
    hsn_code="960810",
    quantity=80,
    rate=25.0,
    gst_perc=18.0,
    unresolved_reason="no product in this vendor's catalogue matches this description",
)


# A line taxed at a different rate from _MATCHED_LINE_ITEM's 18%. Real
# invoices mix them freely — 5% paper board billed alongside 18%
# toiletries — and the response has to carry every line's own rate
# rather than one for the order.
_LOWER_RATED_LINE_ITEM = MatchedLineItem(
    product_id=11,
    product_name="Paper Board",
    description="PAPER BOARD",
    hsn_code="481920",
    quantity=1,
    rate=65.0,
    gst_perc=5.0,
)


def _intake(line_items=(_MATCHED_LINE_ITEM,), **overrides) -> PurchaseInvoiceIntake:
    fields = dict(
        vendor_id=4,
        vendor_name="Shah Clock Agencies",
        vendor_gstin="29ABJPN9424H1Z7",
        invoice_no="Sca/26-27/1147",
        invoice_date=datetime(2026, 4, 22),
        line_items=line_items,
        tax_kind=TaxKind.igst,
        sgst_perc=None,
        cgst_perc=None,
        igst_perc=18.0,
        total_amount_before_tax=1700.0,
        total_amount_after_tax=2006.0,
        printed_total=2006.0,
        total_mismatch=False,
        source="text",
    )
    return PurchaseInvoiceIntake(**{**fields, **overrides})


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
    # One GST rate per line, alongside them — what the order is actually
    # taxed by, since the header percentages can't speak for a mixed invoice.
    assert body["gst_percs"] == [18.0]
    assert body["tax_kind"] == "igst"
    assert body["igst_perc"] == 18.0
    assert body["source"] == "text"
    # What each invoice line was matched to, for the admin to check.
    assert body["line_items"][0]["description"] == "Ab80 Gym Shaker Bottle Green"
    assert body["line_items"][0]["product_name"] == "Ab80 Gym Shaker Bottle"


def test_a_line_whose_product_isnt_on_file_comes_back_unresolved(monkeypatch):
    # The upload used to be refused outright over this, which forced the
    # admin to abandon it, add the product and start again. Now the line
    # comes back with a null product_id and a reason, and the review screen
    # asks them to point it at a product or create one.
    _stub(monkeypatch, _intake(line_items=(_UNRESOLVED_LINE_ITEM,)))

    response = _post()

    assert response.status_code == 200
    body = response.json()
    assert body["product_ids"] == [None]

    (line_item,) = body["line_items"]
    assert line_item["product_id"] is None
    assert line_item["product_name"] is None
    assert line_item["unresolved_reason"] == "no product in this vendor's catalogue matches this description"
    # Read off the invoice, so the form that creates the missing product can
    # pre-fill itself rather than sending the admin back to the PDF.
    assert (line_item["description"], line_item["hsn_code"]) == ("BALL PEN", "960810")
    assert (line_item["quantity"], line_item["rate"], line_item["gst_perc"]) == (80, 25.0, 18.0)


def test_a_resolved_line_carries_no_unresolved_reason(monkeypatch):
    _stub(monkeypatch, _intake())

    (line_item,) = _post().json()["line_items"]

    assert line_item["product_id"] == 9
    assert line_item["unresolved_reason"] is None


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        # The PDF itself couldn't be read in full — nothing to argue with.
        (InvoiceExtractionError("couldn't read the invoice date from this invoice"), 422),
        # A record the admin has to add before this invoice can be accepted.
        # Only the vendor: an unplaceable product is answered with an
        # unresolved line item, not a refusal — see the test below.
        (VendorNotFoundError("no vendor with GSTIN 29ABJPN9424H1Z7"), 404),
        # Already recorded — a re-upload, not a second purchase.
        (DuplicateInvoiceError("invoice Sca/26-27/1147 from this vendor has already been recorded"), 409),
    ],
)
def test_every_refusal_answers_with_its_own_status_and_reason(monkeypatch, error, expected_status):
    _stub(monkeypatch, error)

    response = _post()

    assert response.status_code == expected_status
    # The message is written for the admin and is shown to them verbatim, so
    # it has to survive the trip rather than being replaced by a generic one.
    assert response.json()["detail"] == str(error)


def test_a_mixed_rate_invoice_comes_back_with_each_line_at_its_own_rate(monkeypatch):
    # This upload used to be refused with a 400: a purchase order held one
    # header-level rate, so there was nowhere to put the second one. The rate
    # belongs to the line item now, and the only thing the order still decides
    # is which heads carry it — so the invoice records exactly as printed.
    _stub(
        monkeypatch,
        _intake(
            line_items=(_MATCHED_LINE_ITEM, _LOWER_RATED_LINE_ITEM),
            # No single percentage is true of this order, so it carries none.
            sgst_perc=None,
            cgst_perc=None,
            igst_perc=None,
            total_amount_before_tax=1765.0,
            total_amount_after_tax=2074.25,
            printed_total=2074.25,
        ),
    )

    response = _post()

    assert response.status_code == 200
    body = response.json()
    assert body["gst_percs"] == [18.0, 5.0]
    # The heads still hold — they come from the two states, not the rates.
    assert body["tax_kind"] == "igst"
    assert (body["sgst_perc"], body["cgst_perc"], body["igst_perc"]) == (None, None, None)
    assert [item["gst_perc"] for item in body["line_items"]] == [18.0, 5.0]
