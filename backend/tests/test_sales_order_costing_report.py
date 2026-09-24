# Unit tests for _build_costing_report_rows in app/api/routes/sales_orders.py
# — the per-product-per-order cost rows behind the "Costing" view on the
# Sales orders tab. Pure, so no Mongo connection is needed; Documents are
# built with model_construct because a Beanie Document can only be
# constructed normally once its collection is initialized.
from datetime import datetime

import pytest

from app.api.routes.sales_orders import _build_costing_report_rows
from app.models import ProductDetails, SalesOrderCosting, SalesOrders, SalesSummary
from app.models.sales_order_costing import PrintingCost


def _order(id=1):
    return SalesOrders.model_construct(
        id=id, order_no=100 + id, order_status_id=1, cust_id=5, date=datetime(2026, 9, 1)
    )


def _line(id, product_id=7, quantity=10, sales_order_id=1):
    return SalesSummary.model_construct(
        id=id, sales_order_id=sales_order_id, product_id=product_id, quantity=quantity
    )


def _costing(sales_summary_id, product_id=7, sales_order_id=1, **fields):
    defaults = dict(
        net_purchase_rate=0.0, purchase_tax_perc=0.0, printing_costs=[], delivery=0.0, miscellaneous=0.0
    )
    return SalesOrderCosting.model_construct(
        sales_order_id=sales_order_id,
        sales_summary_id=sales_summary_id,
        product_id=product_id,
        **{**defaults, **fields},
    )


PRODUCTS = {7: ProductDetails.model_construct(id=7, product_name="Mug", vendor_rate=50.0, gst_perc=12.0)}


def test_two_lines_of_one_product_merge_into_one_row():
    rows = _build_costing_report_rows(
        [_order()],
        [_line(1, quantity=10), _line(2, quantity=5)],
        [
            _costing(
                1,
                net_purchase_rate=40.0,
                purchase_tax_perc=18.0,
                printing_costs=[PrintingCost(printing_type="UV", cost_per_unit=5.0, is_taxable=True, tax_perc=18.0)],
                delivery=30.0,
            ),
            _costing(
                2,
                net_purchase_rate=60.0,
                printing_costs=[PrintingCost(printing_type=" uv ", cost_per_unit=4.0)],
                miscellaneous=20.0,
            ),
        ],
        PRODUCTS,
    )

    assert len(rows) == 1
    row = rows[0]
    assert row.quantity == 15
    assert row.purchase_cost == pytest.approx(400 + 300)
    assert row.purchase_tax == pytest.approx(72)
    # "UV" and " uv " are one printing type; only the taxable one adds tax.
    assert [(p.printing_type, p.cost, p.tax) for p in row.printing_costs] == [("UV", 70.0, pytest.approx(9.0))]
    assert (row.delivery, row.miscellaneous) == (30.0, 20.0)
    assert row.total_cost == pytest.approx(700 + 70 + 30 + 20)
    assert row.is_costed is True


def test_uncosted_line_falls_back_to_product_master_and_is_flagged():
    rows = _build_costing_report_rows([_order()], [_line(1, quantity=4)], [], PRODUCTS)

    row = rows[0]
    assert row.purchase_cost == 200.0
    assert row.purchase_tax == pytest.approx(24.0)
    assert row.total_cost == 200.0
    assert row.is_costed is False


def test_legacy_row_counts_its_flat_costs_once_across_lines():
    rows = _build_costing_report_rows(
        [_order()],
        [_line(1, quantity=10), _line(2, quantity=5)],
        [_costing(None, net_purchase_rate=10.0, delivery=100.0)],
        PRODUCTS,
    )

    row = rows[0]
    assert row.purchase_cost == 150.0
    assert row.delivery == 100.0
    assert row.is_costed is True


def test_different_products_and_orders_get_separate_rows():
    products = {**PRODUCTS, 9: ProductDetails.model_construct(id=9, product_name="Pen", vendor_rate=1.0, gst_perc=0.0)}
    rows = _build_costing_report_rows(
        [_order(2), _order(1)],
        [_line(1, product_id=7), _line(2, product_id=9), _line(3, product_id=7, sales_order_id=2)],
        [],
        products,
    )

    assert [(row.sales_order_id, row.product_name) for row in rows] == [(1, "Mug"), (1, "Pen"), (2, "Mug")]


def test_blank_printing_entry_is_ignored():
    # "Add printing type" clicked and saved untouched: no type, no cost.
    rows = _build_costing_report_rows(
        [_order()],
        [_line(1)],
        [_costing(1, printing_costs=[PrintingCost(printing_type="", cost_per_unit=0.0)])],
        PRODUCTS,
    )

    assert rows[0].printing_costs == []
