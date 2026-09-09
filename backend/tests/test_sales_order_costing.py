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
    delivery_tax_amount,
)
from app.api.routes.invoices import delivery_charge_lines


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


# ---------------------------------------------------------------------------
# Delivery charged to the customer (SalesOrders.delivery_charge)
# ---------------------------------------------------------------------------
# The charge is billed on top of the goods and taxed in its own right, so the
# thing worth pinning down is that it reaches the ORDER TOTALS without
# touching the per-line figures — those become #sales_summary rows, and
# delivery is not a product. The invoice prints it as its own line instead
# (delivery_charge_lines in routes/invoices.py), and the two have to agree to
# the paisa or the document won't add up to its own total.
def test_delivery_charge_lands_in_the_totals_and_is_taxed_in_its_own_right():
    subtotals, tax_amounts, before_tax, tax, after_tax = _compute_line_items_and_totals(
        quantities=[10],
        rates=[100.0],
        tax_percs=[18.0],
        delivery_charge=500.0,
        delivery_tax_perc=18.0,
    )
    # The goods' own line is untouched by it.
    assert subtotals == [1000.0]
    assert tax_amounts == [180.0]
    # ...but the order owes for both.
    assert before_tax == 1500.0
    assert tax == pytest.approx(270.0)  # 180 on the goods + 90 on the delivery
    assert after_tax == pytest.approx(1770.0)


def test_delivery_can_be_taxed_at_a_different_rate_from_the_goods():
    _, _, before_tax, tax, _ = _compute_line_items_and_totals(
        quantities=[10], rates=[100.0], tax_percs=[12.0], delivery_charge=200.0, delivery_tax_perc=18.0
    )
    assert before_tax == 1200.0
    assert tax == pytest.approx(120.0 + 36.0)


def test_an_order_level_discount_does_not_reduce_the_delivery_charge():
    # The discount is a discount on the goods — it is validated against the
    # goods' subtotal (_reject_overall_discount_above_subtotal), so it must
    # not quietly eat into freight as well.
    _, _, before_tax, tax, _ = _compute_line_items_and_totals(
        quantities=[10],
        rates=[100.0],
        tax_percs=[18.0],
        overall_discount=200.0,
        delivery_charge=500.0,
        delivery_tax_perc=18.0,
    )
    assert before_tax == 1300.0  # 800 of goods + 500 of delivery
    assert tax == pytest.approx(144.0 + 90.0)


def test_no_delivery_charge_leaves_every_total_exactly_as_it_was():
    # What every order raised before the field existed reads as.
    with_defaults = _compute_line_items_and_totals(quantities=[10], rates=[100.0], tax_percs=[18.0])
    explicit_zero = _compute_line_items_and_totals(
        quantities=[10], rates=[100.0], tax_percs=[18.0], delivery_charge=0.0, delivery_tax_perc=18.0
    )
    assert with_defaults == explicit_zero == ([1000.0], [180.0], 1000.0, 180.0, 1180.0)


class _Order:
    """Stands in for a SalesOrders row — delivery_charge_lines reads two fields."""

    def __init__(self, delivery_charge: float, delivery_tax_perc: float = 18.0) -> None:
        self.delivery_charge = delivery_charge
        self.delivery_tax_perc = delivery_tax_perc


def test_the_invoice_line_carries_the_same_tax_the_order_total_was_built_from():
    (line,) = delivery_charge_lines([_Order(500.0, 18.0)])

    assert line.amount == 500.0
    assert line.tax_amount == delivery_tax_amount(500.0, 18.0) == 90.0
    assert line.total == 590.0


def test_orders_without_a_delivery_charge_print_no_delivery_line():
    assert delivery_charge_lines([_Order(0.0), _Order(0.0, 0.0)]) == []


def test_each_order_on_a_multi_order_invoice_keeps_its_own_delivery_line():
    # Two orders billed together can have been delivered under different
    # arrangements; merging them would print one figure matching neither.
    lines = delivery_charge_lines([_Order(500.0, 18.0), _Order(300.0, 5.0)])

    assert [(line.amount, line.tax_perc) for line in lines] == [(500.0, 18.0), (300.0, 5.0)]
    assert [line.tax_amount for line in lines] == pytest.approx([90.0, 15.0])


def test_the_printed_invoice_lines_add_up_to_the_order_total_they_were_billed_from():
    """The property that actually matters end to end.

    An invoice snapshots its totals from the sales order
    (_sum_sales_order_totals in routes/invoices.py) but prints its rows from
    #sales_summary plus the delivery line. Those two paths are computed by
    different code, so if they ever drift the customer gets a document whose
    rows don't sum to its own grand total. This pins them together.
    """
    quantities, rates, tax_percs = [10, 4], [100.0, 250.0], [18.0, 12.0]
    delivery_charge, delivery_tax_perc = 500.0, 18.0

    line_subtotals, tax_amounts, _, _, order_total_after_tax = _compute_line_items_and_totals(
        quantities,
        rates,
        tax_percs,
        overall_discount=200.0,
        delivery_charge=delivery_charge,
        delivery_tax_perc=delivery_tax_perc,
    )

    # What #sales_summary stores for each product line: subtotal + its tax.
    printed = [subtotal + tax for subtotal, tax in zip(line_subtotals, tax_amounts)]
    # ...plus the delivery row the invoice appends.
    printed += [line.total for line in delivery_charge_lines([_Order(delivery_charge, delivery_tax_perc)])]

    assert sum(printed) == pytest.approx(order_total_after_tax)
