# Unit tests for how a purchase order's money and GST fields are derived from
# its line items (the pure helpers in app/api/routes/orders.py). No database
# connection and no TestClient, same approach as test_accounts.py — these are
# arithmetic and a couple of branches, and everything around them is covered
# by the frontend's round-trip.
#
# The rule they exist to hold down: the GST rate belongs to the LINE, not the
# order. A vendor invoice routinely taxes its lines at different rates (5%
# paper board billed alongside 18% toiletries on one Hello Pen Mart bill),
# and every one of these helpers has to keep that faithful rather than
# collapsing it to an average.
from datetime import datetime

import pytest

from app.api.routes.orders import _compute_totals, _header_percs, _line_gst_percs
from app.schemas.purchase_orders import CreateNewPurchaseOrderRequest
from app.services.gst import TaxKind


def _request(**overrides) -> CreateNewPurchaseOrderRequest:
    fields = dict(
        purchase_order_no="HPM/26-27/1621",
        vendor_id=2,
        date=datetime(2026, 5, 19),
        product_ids=[48, 52],
        quantities=[2, 1],
        rates=[660.0, 65.0],
        description="Vendor invoice HPM/26-27/1621",
    )
    return CreateNewPurchaseOrderRequest(**{**fields, **overrides})


def test_totals_tax_each_line_at_its_own_rate():
    # The real ₹2,936.00 Hello Pen Mart invoice: 18% on the toiletries, 5% on
    # the paper board. One blended rate over the subtotal would have put the
    # wrong tax on both lines and missed the invoice's own printed total.
    before, after = _compute_totals([2, 2, 1], [660.0, 555.0, 65.0], [18.0, 18.0, 5.0])

    assert before == 2495.00
    assert round(after, 2) == 2935.65


def test_totals_on_a_single_rate_order_are_unchanged():
    # What the old header-level arithmetic produced, which every existing
    # order was costed by.
    before, after = _compute_totals([10], [250.0], [18.0])

    assert (before, round(after, 2)) == (2500.00, 2950.00)


def test_a_line_taxed_at_nothing_contributes_only_its_taxable_value():
    before, after = _compute_totals([1, 1], [100.0, 100.0], [18.0, 0.0])

    assert (before, round(after, 2)) == (200.00, 218.00)


def test_line_rates_are_taken_from_the_payload_when_it_sends_them():
    assert _line_gst_percs(_request(gst_percs=[18.0, 5.0])) == [18.0, 5.0]


def test_a_payload_with_only_header_percentages_taxes_every_line_at_them():
    # Back-compatibility: that is exactly what those fields used to mean, so
    # a caller that predates the per-line array still costs its order the way
    # it always did.
    assert _line_gst_percs(_request(sgst_perc=9.0, cgst_perc=9.0)) == [18.0, 18.0]
    assert _line_gst_percs(_request(igst_perc=18.0)) == [18.0, 18.0]


def test_a_payload_with_no_gst_at_all_taxes_every_line_at_nothing():
    assert _line_gst_percs(_request()) == [0, 0]


@pytest.mark.parametrize(
    ("tax_kind", "expected"),
    [
        # Intra-state: half the rate under each of CGST and SGST.
        (TaxKind.cgst_sgst, (9.0, 9.0, None)),
        # Inter-state: the whole rate on IGST alone.
        (TaxKind.igst, (None, None, 18.0)),
    ],
)
def test_one_rate_across_the_lines_is_summarised_under_its_heads(tax_kind, expected):
    assert _header_percs([18.0, 18.0], tax_kind) == expected


def test_lines_at_different_rates_leave_the_order_with_no_header_percentage():
    # No single percentage is true of a mixed-rate order, and an average
    # would be a number that matches no line on the invoice. The rates
    # themselves are safe on the #purchase_summary rows; this only governs
    # the derived summary the order screens read.
    assert _header_percs([18.0, 5.0], TaxKind.igst) == (None, None, None)


def test_a_zero_rated_order_carries_no_header_percentage_either():
    assert _header_percs([0.0, 0.0], TaxKind.igst) == (None, None, None)
