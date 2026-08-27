# Unit tests for the pure parts of the printing purchase order side: the
# money/GST helpers in app/api/routes/printing_orders.py, the vendor-type
# rules that decide which side of purchasing an uploaded invoice belongs on,
# and the line-item validation that a printing line can't be blank. No
# database connection and no TestClient, same approach as
# test_purchase_order_totals.py and test_purchase_invoice_intake.py.
#
# The rule the whole printing side exists to hold down is not arithmetic
# though — it's that a printing purchase never reaches the inventory code.
# That is structural (see routes/printing_orders.py's docstring: there is no
# stock call to get wrong), so what's testable here is the boundary that
# keeps a purchase on the correct side of it in the first place: the vendor's
# type.
import pytest

from app.api.routes.printing_orders import _compute_totals, _header_percs, _hsn_codes_for
from app.models import VendorDetails
from app.models.vendor_details import VendorType
from app.schemas.printing_purchase_orders import CreateNewPrintingPurchaseOrderRequest
from app.services.gst import TaxKind
from app.services.printing_purchase_invoice_intake import (
    WrongVendorTypeError,
    _require_printing_vendor,
    _single_gst_perc,
)
from app.services.printing_purchase_invoice_intake import PrintingLineItem
from datetime import datetime


def _vendor(vendor_type: VendorType | None) -> VendorDetails:
    # model_construct rather than the constructor: a Beanie Document can only
    # be instantiated normally once its collection has been initialized
    # against a live Mongo connection, which these tests deliberately don't
    # have.
    return VendorDetails.model_construct(
        id=1, registered_name="Pearl Creation", vendor_type=vendor_type
    )


def _request(**overrides) -> CreateNewPrintingPurchaseOrderRequest:
    fields = dict(
        purchase_order_no="PC/2026-27/72",
        vendor_id=1,
        date=datetime(2026, 8, 24),
        descriptions=["Customized Print Service"],
        quantities=[150],
        rates=[20.0],
        gst_percs=[18.0],
        description="Vendor invoice PC/2026-27/72",
    )
    return CreateNewPrintingPurchaseOrderRequest(**{**fields, **overrides})


def _line_item(gst_perc: float) -> PrintingLineItem:
    return PrintingLineItem(
        description="Customized Print Service",
        hsn_code="998912",
        quantity=150,
        rate=20.0,
        gst_perc=gst_perc,
    )


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------
def test_totals_match_the_pearl_creation_invoice():
    # The real PC/2026-27/72 bill: 150 pcs of a print service at ₹20, IGST
    # 18%, printed total ₹3,540.00.
    before, after = _compute_totals([150], [20.0], [18.0])

    assert before == 3000.00
    assert round(after, 2) == 3540.00


def test_totals_match_the_paramount_invoice():
    # The real PIE-5778 bill: one sticker-printing line at ₹350, IGST 18%,
    # printed total ₹413.00.
    before, after = _compute_totals([1], [350.0], [18.0])

    assert before == 350.00
    assert round(after, 2) == 413.00


def test_totals_tax_each_printing_line_at_its_own_rate():
    # A printing bill can mix rates just as a material one can, so the rate
    # is the line's — collapsing these to an average would put the wrong tax
    # on both.
    before, after = _compute_totals([1, 1], [350.0, 100.0], [18.0, 5.0])

    assert before == 450.00
    assert round(after, 2) == 518.00


# ---------------------------------------------------------------------------
# Which heads the rates are filed under
# ---------------------------------------------------------------------------
def test_a_single_rate_inter_state_order_files_it_all_under_igst():
    assert _header_percs([18.0], TaxKind.igst) == (None, None, 18.0)


def test_a_single_rate_intra_state_order_halves_it_across_cgst_and_sgst():
    assert _header_percs([18.0], TaxKind.cgst_sgst) == (9.0, 9.0, None)


def test_a_mixed_rate_order_has_no_header_percentage_at_all():
    # No single percentage is true of it, and storing an average would be the
    # blending the per-line rates exist to avoid. The line items keep both
    # rates either way.
    assert _header_percs([18.0, 5.0], TaxKind.igst) == (None, None, None)


def test_a_zero_rated_order_has_no_header_percentage():
    assert _header_percs([0.0], TaxKind.igst) == (None, None, None)


# ---------------------------------------------------------------------------
# Line items
# ---------------------------------------------------------------------------
def test_hsn_codes_default_to_blanks_when_the_caller_sends_none():
    # Plenty of printing bills print no SAC at all, so a caller that omits
    # them means "none of these have one" rather than a length mismatch.
    assert _hsn_codes_for(_request(descriptions=["A", "B"], quantities=[1, 1], rates=[1.0, 1.0], gst_percs=[18.0, 18.0])) == ["", ""]


def test_hsn_codes_are_kept_when_the_caller_sends_them():
    assert _hsn_codes_for(_request(hsn_codes=["998912"])) == ["998912"]


def test_a_blank_description_is_rejected():
    # The description IS the line item here — an empty one would record a
    # charge against nothing at all, where a material order at least still
    # points at a product.
    with pytest.raises(ValueError):
        _request(descriptions=["   "])


def test_mismatched_line_item_arrays_are_rejected():
    with pytest.raises(ValueError):
        _request(descriptions=["A", "B"], quantities=[1], rates=[1.0], gst_percs=[18.0])


def test_an_order_with_no_line_items_is_rejected():
    with pytest.raises(ValueError):
        _request(descriptions=[], quantities=[], rates=[], gst_percs=[])


def test_one_rate_is_read_off_lines_that_agree():
    assert _single_gst_perc((_line_item(18.0), _line_item(18.0))) == 18.0


def test_no_single_rate_is_read_off_lines_that_disagree():
    assert _single_gst_perc((_line_item(18.0), _line_item(5.0))) is None


# ---------------------------------------------------------------------------
# Vendor type — which side of purchasing an uploaded invoice belongs on
# ---------------------------------------------------------------------------
def test_a_printing_vendors_invoice_is_accepted():
    assert _require_printing_vendor(_vendor(VendorType.printing)) is None


def test_a_material_vendors_invoice_is_refused_and_says_where_it_belongs():
    # Not a failure to read the PDF — the upload is simply in the wrong
    # place, and the message has to name the right one or the admin is stuck.
    with pytest.raises(WrongVendorTypeError) as error:
        _require_printing_vendor(_vendor(VendorType.material))

    assert "material vendor" in str(error.value)
    assert "Material" in str(error.value)


def test_an_untyped_vendors_invoice_is_refused_rather_than_guessed_at():
    # Legacy vendors carry no type. Guessing would file the bill on the wrong
    # side — and a material purchase moves stock — so the admin is asked to
    # set the type instead.
    with pytest.raises(WrongVendorTypeError) as error:
        _require_printing_vendor(_vendor(None))

    assert "no vendor type on file" in str(error.value)
