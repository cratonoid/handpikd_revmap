# Unit tests for the sales order costing arithmetic in
# app/api/routes/sales_orders.py. Both functions under test are pure, so no
# Mongo connection or TestClient is needed here — the endpoints that use them
# are covered by the frontend's own round-trip.
#
# What matters is that the order's headline totals stay reconcilable with the
# "Add details" sheet: tax is charged on the discounted subtotal, and a
# product spread over two line items shares one discount between them.
import pytest

from app.api.routes.sales_orders import (
    _allocate_line_discounts,
    _allocate_overall_discount,
    _compute_line_items_and_totals,
)


def test_no_discounts_reduces_to_quantity_times_rate():
    # The pre-costing behaviour, which every un-costed order still relies on.
    subtotals, tax_amounts, before_tax, tax, after_tax = _compute_line_items_and_totals(
        quantities=[10, 4], rates=[100.0, 250.0], tax_percs=[18.0, 12.0]
    )
    assert subtotals == [1000.0, 1000.0]
    assert tax_amounts == [180.0, 120.0]
    assert (before_tax, tax, after_tax) == (2000.0, 300.0, 2300.0)


def test_tax_is_charged_on_the_discounted_subtotal():
    subtotals, tax_amounts, before_tax, tax, after_tax = _compute_line_items_and_totals(
        quantities=[10], rates=[100.0], tax_percs=[18.0], discounts=[200.0]
    )
    assert subtotals == [800.0]
    assert tax_amounts == [144.0]  # 18% of 800, not of 1000
    assert (before_tax, tax, after_tax) == (800.0, 144.0, 944.0)


def test_discount_is_ignored_for_products_without_a_costing_row():
    discounts = _allocate_line_discounts(
        discount_by_product={7: 150.0}, product_ids=[7, 9], quantities=[3, 3], rates=[100.0, 100.0]
    )
    assert discounts == [150.0, 0.0]


def test_one_products_discount_splits_pro_rata_across_its_lines():
    # Product 7 on two lines worth 300 and 100 — a single 200 discount lands
    # 3:1 between them so each line's tax stays proportionate.
    discounts = _allocate_line_discounts(
        discount_by_product={7: 200.0}, product_ids=[7, 7], quantities=[3, 1], rates=[100.0, 100.0]
    )
    assert discounts == [150.0, 50.0]
    assert sum(discounts) == 200.0


def test_zero_value_lines_split_evenly_instead_of_dividing_by_zero():
    discounts = _allocate_line_discounts(
        discount_by_product={7: 50.0}, product_ids=[7, 7], quantities=[0, 0], rates=[0.0, 0.0]
    )
    assert discounts == [25.0, 25.0]


def test_empty_costing_short_circuits_to_zeroes():
    assert _allocate_line_discounts({}, [7, 9], [1, 2], [10.0, 20.0]) == [0.0, 0.0]


# ---------------------------------------------------------------------------
# The order-level discount (SalesOrders.overall_discount)
# ---------------------------------------------------------------------------
def test_overall_discount_comes_off_the_subtotal_before_tax():
    subtotals, tax_amounts, before_tax, tax, after_tax = _compute_line_items_and_totals(
        quantities=[10], rates=[100.0], tax_percs=[18.0], overall_discount=200.0
    )
    assert subtotals == [800.0]
    assert tax_amounts == [144.0]  # 18% of 800, not of 1000
    assert (before_tax, tax, after_tax) == (800.0, 144.0, 944.0)


def test_overall_discount_splits_pro_rata_across_lines():
    # Lines worth 750 and 250 share a 100 discount 3:1, so each line's tax
    # still sits on its own discounted value.
    subtotals, tax_amounts, before_tax, _, _ = _compute_line_items_and_totals(
        quantities=[3, 1], rates=[250.0, 250.0], tax_percs=[18.0, 12.0], overall_discount=100.0
    )
    assert subtotals == [675.0, 225.0]
    assert tax_amounts == [121.5, 27.0]
    assert before_tax == 900.0


def test_overall_discount_stacks_on_top_of_the_costing_discounts():
    # 1000 of goods, 200 already off on the costing sheet, then 80 off the
    # order as a whole — tax lands on what's left of the two.
    subtotals, tax_amounts, before_tax, _, after_tax = _compute_line_items_and_totals(
        quantities=[10], rates=[100.0], tax_percs=[18.0], discounts=[200.0], overall_discount=80.0
    )
    assert subtotals == [720.0]
    assert tax_amounts == [129.6]
    assert (before_tax, after_tax) == (720.0, 849.6)


def test_overall_discount_is_split_by_value_net_of_the_costing_discounts():
    # Both lines start at 500, but the first is already 300 off on the sheet.
    # The 100 order discount therefore lands 200:500, not 50:50.
    shares = _allocate_overall_discount(100.0, [200.0, 500.0])
    assert shares == pytest.approx([100.0 * 2 / 7, 100.0 * 5 / 7])
    assert sum(shares) == pytest.approx(100.0)


def test_overall_discount_on_zero_value_lines_splits_evenly():
    assert _allocate_overall_discount(50.0, [0.0, 0.0]) == [25.0, 25.0]


def test_no_overall_discount_short_circuits_to_zeroes():
    assert _allocate_overall_discount(0.0, [100.0, 200.0]) == [0.0, 0.0]
