# Unit tests for billed_totals / partials_alongside in
# app/services/invoice_totals.py: what a partial invoice bills (a percentage
# or a fixed amount of its orders), and what the full invoice after partials
# bills (the orders less those partials). Pure, so no Mongo connection.
from types import SimpleNamespace

from app.models.invoice_details import InvoiceBilling, InvoiceType
from app.services.invoice_totals import billed_totals, partials_alongside


def _order(order_id: int, before_tax: float, tax: float):
    return SimpleNamespace(
        id=order_id,
        total_amount_before_tax=before_tax,
        total_tax_amount=tax,
        total_amount_after_tax=before_tax + tax,
    )


def _invoice(invoice_id: int, sales_ids: list[int], billing=InvoiceBilling.full, percent=None, amount=None, totals=None):
    before_tax, tax, after_tax = totals or (0.0, 0.0, 0.0)
    return SimpleNamespace(
        id=invoice_id,
        sales_ids=sales_ids,
        type=InvoiceType.standard,
        is_deleted=False,
        billing=billing,
        partial_percent=percent,
        partial_amount=amount,
        total_amount_before_tax=before_tax,
        total_tax_amount=tax,
        total_amount_after_tax=after_tax,
    )


ORDERS = [_order(1, 1000.0, 180.0)]  # ₹1,180 incl. 18% GST


def test_a_full_invoice_without_partials_bills_the_orders():
    assert billed_totals(_invoice(1, [1]), ORDERS, []) == (1000.0, 180.0, 1180.0)


def test_a_percentage_partial_scales_before_tax_and_tax_alike():
    partial = _invoice(1, [1], InvoiceBilling.partial, percent=40)
    assert billed_totals(partial, ORDERS, []) == (400.0, 72.0, 472.0)


def test_an_amount_partial_bills_exactly_that_amount_including_tax():
    partial = _invoice(1, [1], InvoiceBilling.partial, amount=590.0)
    assert billed_totals(partial, ORDERS, []) == (500.0, 90.0, 590.0)


def test_an_uneven_amount_still_adds_up_to_the_amount():
    before_tax, tax, after_tax = billed_totals(_invoice(1, [1], InvoiceBilling.partial, amount=333.33), ORDERS, [])
    assert after_tax == 333.33
    assert round(before_tax + tax, 2) == 333.33


def test_the_full_invoice_after_partials_bills_the_balance():
    partials = [
        _invoice(1, [1], InvoiceBilling.partial, percent=40, totals=(400.0, 72.0, 472.0)),
        _invoice(2, [1], InvoiceBilling.partial, amount=118.0, totals=(100.0, 18.0, 118.0)),
    ]
    assert billed_totals(_invoice(3, [1]), ORDERS, partials) == (500.0, 90.0, 590.0)


def test_partials_alongside_skips_itself_voided_full_and_other_order_sets():
    full = _invoice(10, [1, 2])
    same = _invoice(11, [2, 1], InvoiceBilling.partial, percent=10)
    voided = _invoice(12, [1, 2], InvoiceBilling.partial, percent=10)
    voided.is_deleted = True
    other_set = _invoice(13, [1], InvoiceBilling.partial, percent=10)
    another_full = _invoice(14, [1, 2])
    found = partials_alongside(full, [full, same, voided, other_set, another_full])
    assert [invoice.id for invoice in found] == [11]
