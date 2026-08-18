# Unit tests for the sales order costing arithmetic in
# app/api/routes/sales_orders.py. Both functions under test are pure, so no
# Mongo connection or TestClient is needed here — the endpoints that use them
# are covered by the frontend's own round-trip.
#
# What matters is that the order's headline totals stay reconcilable with the
# "Add details" sheet: tax is charged on the discounted subtotal, and a
# product spread over two line items shares one discount between them.
from app.api.routes.sales_orders import _allocate_line_discounts, _compute_line_items_and_totals


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
