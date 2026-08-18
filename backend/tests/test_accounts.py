# Unit tests for the pure arithmetic behind the accounts module in
# app/api/routes/accounts.py. Every function under test is pure, so no Mongo
# connection or TestClient is needed here — same approach as
# test_sales_order_costing.py, and the endpoints that use them are covered by
# the frontend's own round-trip.
#
# What matters is that the figures stay reconcilable with the modules they
# report on: cost has to agree with what the "Add details" sheet shows the
# admin, the GST heads have to add back to the tax actually paid, and a
# report's month buckets have to cover the whole range even where nothing
# happened.
from datetime import date

import pytest
from fastapi import HTTPException

from app.api.routes.accounts import (
    _aging_bucket,
    _apportion_input_tax,
    _month_span,
    _net_final_cost,
    _validate_range,
)
from app.models.sales_order_costing import PrintingCost


def _cost(quantity, net_purchase_rate=0.0, printing_costs=None, delivery=0.0, miscellaneous=0.0):
    # Thin wrapper so each test names only the fields it cares about.
    return _net_final_cost(
        quantity=quantity,
        net_purchase_rate=net_purchase_rate,
        printing_costs=printing_costs or [],
        delivery=delivery,
        miscellaneous=miscellaneous,
    )


# ---------------------------------------------------------------------------
# Cost side — must match computeCostingFigures' netFinalCost on the frontend
# ---------------------------------------------------------------------------
def test_net_final_cost_scales_purchase_and_printing_but_not_flat_charges():
    # 10 pieces at 100 purchase + 15 printing, plus one-off delivery and misc.
    cost = _cost(
        quantity=10,
        net_purchase_rate=100.0,
        printing_costs=[PrintingCost(printing_type="Laser", cost_per_unit=15.0)],
        delivery=500.0,
        miscellaneous=250.0,
    )
    assert cost == 10 * 100.0 + 10 * 15.0 + 500.0 + 250.0


def test_net_final_cost_excludes_purchase_and_printing_tax():
    # Both taxes are reclaimable input credit, so neither may reach the P&L's
    # cost figure — otherwise margin is understated by the GST paid.
    taxed = _cost(
        quantity=5,
        net_purchase_rate=100.0,
        printing_costs=[PrintingCost(printing_type="UV", cost_per_unit=20.0, is_taxable=True, tax_perc=12.0)],
    )
    untaxed = _cost(
        quantity=5,
        net_purchase_rate=100.0,
        printing_costs=[PrintingCost(printing_type="UV", cost_per_unit=20.0)],
    )
    assert taxed == untaxed == 600.0


def test_net_final_cost_sums_every_printing_process():
    cost = _cost(
        quantity=4,
        printing_costs=[
            PrintingCost(printing_type="Laser", cost_per_unit=10.0),
            PrintingCost(printing_type="Screen", cost_per_unit=7.5),
        ],
    )
    assert cost == 70.0


def test_net_final_cost_keeps_flat_charges_when_quantity_is_zero():
    # An order line whose quantity never got filled in still incurred its
    # delivery — dropping it would flatter the margin.
    assert _cost(quantity=0, net_purchase_rate=100.0, delivery=300.0) == 300.0


# ---------------------------------------------------------------------------
# GST apportionment — the heads must always add back to the tax actually paid
# ---------------------------------------------------------------------------
def test_intra_state_tax_splits_evenly_between_sgst_and_cgst():
    sgst, cgst, igst, unclassified = _apportion_input_tax(1800.0, sgst_perc=9.0, cgst_perc=9.0, igst_perc=0.0)
    assert (sgst, cgst, igst, unclassified) == (900.0, 900.0, 0.0, 0.0)


def test_inter_state_tax_lands_entirely_on_igst():
    sgst, cgst, igst, unclassified = _apportion_input_tax(1800.0, sgst_perc=0.0, cgst_perc=0.0, igst_perc=18.0)
    assert (sgst, cgst, igst, unclassified) == (0.0, 0.0, 1800.0, 0.0)


def test_tax_with_no_percentages_recorded_is_unclassified_not_dropped():
    # Covers a purchase order that never had its GST fields set, and a
    # purchase invoice whose order has gone missing — the endpoint passes
    # zeroes for both cases. The tax was still paid, so it must survive.
    assert _apportion_input_tax(450.0, 0.0, 0.0, 0.0) == (0.0, 0.0, 0.0, 450.0)


def test_apportionment_ignores_drift_between_the_order_and_the_invoice():
    # The order says 18% but the invoice snapshotted tax from a different
    # taxable value. The percentages decide only the RATIO; the stored total
    # is what gets divided up, so the heads still reconcile.
    sgst, cgst, igst, unclassified = _apportion_input_tax(1000.0, sgst_perc=9.0, cgst_perc=9.0, igst_perc=0.0)
    assert sgst + cgst + igst + unclassified == 1000.0


@pytest.mark.parametrize(
    "tax,sgst_perc,cgst_perc,igst_perc",
    [
        (1234.56, 9.0, 9.0, 0.0),
        (999.99, 2.5, 2.5, 0.0),
        (1.0, 0.0, 0.0, 5.0),
        (0.0, 9.0, 9.0, 0.0),
        (750.0, 0.0, 0.0, 0.0),
    ],
)
def test_heads_always_reconcile_to_the_input_tax(tax, sgst_perc, cgst_perc, igst_perc):
    # The tax tab shows the four heads under a "Total input tax" row, so any
    # rounding that failed to reconcile would be visible as a wrong total.
    parts = _apportion_input_tax(tax, sgst_perc, cgst_perc, igst_perc)
    assert sum(parts) == pytest.approx(tax)


# ---------------------------------------------------------------------------
# Aging buckets
# ---------------------------------------------------------------------------
def test_invoice_not_yet_past_its_due_date_is_not_aged():
    assert _aging_bucket(0, is_overdue=False) == "not_due"


@pytest.mark.parametrize(
    "days,expected",
    [(1, "d0_30"), (30, "d0_30"), (31, "d31_60"), (60, "d31_60"), (61, "d61_90"), (90, "d61_90"), (91, "d90_plus")],
)
def test_aging_boundaries_are_inclusive_at_the_top_of_each_bucket(days, expected):
    assert _aging_bucket(days, is_overdue=True) == expected


# ---------------------------------------------------------------------------
# Month buckets
# ---------------------------------------------------------------------------
def test_month_span_covers_every_month_touched_by_the_range():
    span = _month_span(date(2026, 1, 15), date(2026, 3, 2))
    assert span == [("2026-01", "Jan 2026"), ("2026-02", "Feb 2026"), ("2026-03", "Mar 2026")]


def test_month_span_rolls_over_the_year_boundary():
    span = _month_span(date(2025, 11, 1), date(2026, 2, 28))
    assert [key for key, _ in span] == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_a_range_inside_one_month_is_a_single_bucket():
    assert _month_span(date(2026, 6, 3), date(2026, 6, 20)) == [("2026-06", "Jun 2026")]


def test_month_span_is_capped_so_a_mistyped_year_cannot_blow_up_the_chart():
    # A date input accepts "0202-01-01" quite happily; without the cap that
    # would ask for ~22,000 buckets.
    assert len(_month_span(date(202, 1, 1), date(2026, 1, 1))) == 120


# ---------------------------------------------------------------------------
# Range validation
# ---------------------------------------------------------------------------
def test_range_bounds_are_inclusive_on_both_ends():
    start_dt, end_dt = _validate_range(date(2026, 4, 1), date(2026, 4, 30))
    # An invoice stamped late on the last day of the range must still count.
    assert start_dt.hour == 0 and start_dt.minute == 0
    assert (end_dt.hour, end_dt.minute, end_dt.second) == (23, 59, 59)
    assert start_dt.date() == date(2026, 4, 1)
    assert end_dt.date() == date(2026, 4, 30)


def test_a_single_day_range_is_allowed():
    start_dt, end_dt = _validate_range(date(2026, 4, 1), date(2026, 4, 1))
    assert start_dt < end_dt


def test_an_inverted_range_is_rejected_rather_than_silently_returning_nothing():
    with pytest.raises(HTTPException) as excinfo:
        _validate_range(date(2026, 4, 30), date(2026, 4, 1))
    assert excinfo.value.status_code == 400
