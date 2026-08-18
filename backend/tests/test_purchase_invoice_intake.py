# Unit tests for the pure part of app/services/purchase_invoice_intake.py —
# the two rules that decide whether an uploaded vendor invoice is accepted at
# all, and neither of which touches Mongo. Same approach as test_accounts.py:
# no database connection or TestClient, with the endpoint itself covered by
# the frontend's round-trip.
#
# Both rules exist to stop a wrong purchase order being created silently: a
# purchase order moves stock and lands in the accounts totals, so matching
# the wrong product or averaging two GST rates is worse than refusing the
# upload and making the admin key it in.
import pytest

from app.models import ProductDetails
from app.services.purchase_invoice_intake import (
    MatchedLineItem,
    ProductNotFoundError,
    UnsupportedInvoiceError,
    _match_product,
    _single_gst_perc,
)


def _product(id: int, product_name: str) -> ProductDetails:
    # model_construct rather than the constructor: a Beanie Document can only
    # be instantiated normally once its collection has been initialized
    # against a live Mongo connection, which these tests deliberately don't
    # have. Matching reads nothing but the id and the name anyway.
    return ProductDetails.model_construct(id=id, product_name=product_name)


def _line_item(gst_perc: float) -> MatchedLineItem:
    return MatchedLineItem(
        product_id=1,
        product_name="Ab80 Gym Shaker Bottle",
        description="Ab80 Gym Shaker Bottle",
        quantity=1,
        rate=85.0,
        gst_perc=gst_perc,
    )


def test_matches_a_product_whose_name_differs_only_in_case_and_punctuation():
    products = [_product(7, "Fogg Combo Set")]

    assert _match_product("FOGG ( COMBO SET )", products).id == 7


def test_matches_a_product_named_inside_a_longer_invoice_description():
    # Vendors pad the description with sizes, finishes and pack counts.
    products = [_product(3, "Frigde Magnet")]

    assert _match_product("3 mm Frigde Magnet 100 pcs with UV print (58 x 58 mm)", products).id == 3


def test_refuses_a_description_that_matches_two_products():
    # Choosing between them would be a guess about which product's stock
    # moves, so the upload is refused and both candidates are named.
    products = [_product(1, "Shaker Bottle"), _product(2, "Gym Shaker Bottle")]

    with pytest.raises(ProductNotFoundError) as error:
        _match_product("Ab80 Gym Shaker Bottle Green", products)

    assert "Shaker Bottle" in str(error.value)
    assert "Gym Shaker Bottle" in str(error.value)


def test_refuses_a_description_matching_nothing_in_the_vendors_catalogue():
    with pytest.raises(ProductNotFoundError) as error:
        _match_product("Ab80 Gym Shaker Bottle", [_product(1, "Fridge Magnet")])

    assert "add the product first" in str(error.value)


def test_a_single_gst_rate_across_the_line_items_is_the_orders_rate():
    assert _single_gst_perc((_line_item(18.0), _line_item(18.0))) == 18.0


def test_line_items_taxed_at_different_rates_are_refused():
    # A purchase order holds one header-level GST rate, so a mixed-rate
    # invoice has no faithful representation — blending them would put the
    # wrong tax on every line.
    with pytest.raises(UnsupportedInvoiceError) as error:
        _single_gst_perc((_line_item(18.0), _line_item(5.0)))

    assert "5%" in str(error.value)
    assert "18%" in str(error.value)
