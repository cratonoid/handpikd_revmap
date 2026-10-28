# Keeps a standard invoice's snapshotted totals in step with the sales orders
# it was raised against.
#
# A standard invoice has no line items of its own. It SNAPSHOTS its orders'
# totals at the moment it is raised (see billed_totals below, used by
# routes/invoices.py), but its PDF prints those orders' #sales_summary rows
# LIVE — and update_sales_order_details updates every one of those rows on
# each save. So editing an order's amounts after an invoice exists used to
# leave the invoice printing updated rows under an un-updated grand total: a
# document that does not add up, and a figure on the invoices table, the
# accounts receivables report and the client portal that no longer matched
# the order behind it.
#
# Nothing re-snapshotted it, because routes/sales_orders.py knows nothing
# about invoices. This module is that missing step, and lives in services/
# rather than in either route module because both of them need it and
# routes/invoices.py already imports from routes/sales_orders.py — the other
# direction would be a cycle.
#
# What it deliberately does NOT do is re-decide the GST heads.
# update_invoice_details re-runs _tax_context_for_customer because an admin
# saving an invoice has reviewed it and a corrected client state should take
# effect. This runs behind an edit to a DIFFERENT document, with nobody
# looking at the invoice, so the invoice keeps the heads it was raised under
# and only re-splits the new tax total across them.
#
# It is also where an invoice's billing (InvoiceBilling) turns into figures,
# for routes/invoices.py as much as for the refresh below: a partial invoice
# bills a percentage or a fixed amount of its orders, and a full invoice
# bills what its orders' live partials have left.
from beanie.operators import In

from app.models import InvoiceBilling, InvoiceDetails, InvoiceType, SalesOrders
from app.services.gst import split_tax

Totals = tuple[float, float, float]  # (before tax, tax, after tax)


def order_totals(orders: list) -> Totals:
    return (
        sum(order.total_amount_before_tax for order in orders),
        sum(order.total_tax_amount for order in orders),
        sum(order.total_amount_after_tax for order in orders),
    )


def is_partial(invoice) -> bool:
    return getattr(invoice, "billing", InvoiceBilling.full) == InvoiceBilling.partial


def partials_alongside(invoice, candidates: list) -> list:
    """The live partial invoices that share `invoice`'s orders, itself left
    out. Partials and the full invoice after them always list the same
    orders (enforced in routes/invoices.py), so an exact set match is all
    it takes."""
    orders = set(invoice.sales_ids)
    return [
        other
        for other in candidates
        if other.id != invoice.id
        and not other.is_deleted
        and other.type == InvoiceType.standard
        and is_partial(other)
        and set(other.sales_ids) == orders
    ]


def billed_totals(invoice, orders: list, partials: list) -> Totals:
    """What `invoice` bills, given the orders behind it and the live partials
    beside it (partials_alongside). Tax is always the orders' own share, so
    the GST heads still split the way the orders' do."""
    before_tax, tax, after_tax = order_totals(orders)
    if is_partial(invoice):
        if invoice.partial_amount is not None:
            billed_after = invoice.partial_amount
            share = billed_after / after_tax if after_tax else 0.0
        else:
            share = (invoice.partial_percent or 0.0) / 100
            billed_after = round(after_tax * share, 2)
        billed_before = round(before_tax * share, 2)
        return billed_before, round(billed_after - billed_before, 2), round(billed_after, 2)
    if not partials:
        return before_tax, tax, after_tax
    billed_before = round(before_tax - sum(p.total_amount_before_tax for p in partials), 2)
    billed_tax = round(tax - sum(p.total_tax_amount for p in partials), 2)
    return billed_before, billed_tax, round(billed_before + billed_tax, 2)


async def refresh_invoice_totals_for_sales_orders(sales_order_ids: list[int]) -> int:
    """Re-snapshots every live standard invoice raised against these orders.

    Returns how many invoices actually changed, so a caller can log or
    surface it. Voided invoices are skipped — a withdrawn invoice is not a
    document anyone will print again — and so are proforma invoices, which
    carry their own line items and no sales order at all.
    """
    if not sales_order_ids:
        return 0

    invoices = await InvoiceDetails.find(
        InvoiceDetails.type == InvoiceType.standard,
        InvoiceDetails.is_deleted == False,
        In(InvoiceDetails.sales_ids, sales_order_ids),
    ).to_list()
    if not invoices:
        return 0

    # An invoice can cover several orders, only one of which was just edited,
    # so each one is re-totalled from every order it lists rather than from
    # the edited one alone.
    linked_ids = sorted({sales_id for invoice in invoices for sales_id in invoice.sales_ids})
    orders_by_id = {
        order.id: order for order in await SalesOrders.find(In(SalesOrders.id, linked_ids)).to_list()
    }

    updated = 0
    # Partials first: a full invoice beside them bills what they leave, so it
    # has to be worked out from their new figures, not their old ones.
    for invoice in sorted(invoices, key=lambda item: not is_partial(item)):
        linked = [orders_by_id[sales_id] for sales_id in invoice.sales_ids if sales_id in orders_by_id]
        if not linked:
            # Its orders have gone missing entirely. Leave the snapshot
            # alone: a stale total is recoverable, an invoice silently
            # restated to zero is not.
            continue

        totals = billed_totals(invoice, linked, partials_alongside(invoice, invoices))
        if totals == (
            invoice.total_amount_before_tax,
            invoice.total_tax_amount,
            invoice.total_amount_after_tax,
        ):
            # The overwhelmingly common case — an order was saved without its
            # amounts moving. Skipped rather than written back so an edit to
            # a description doesn't churn every invoice behind it.
            continue

        before_tax, tax, after_tax = totals
        invoice.total_amount_before_tax = before_tax
        invoice.total_amount_after_tax = after_tax
        invoice.total_tax_amount = tax
        if invoice.tax_kind is not None:
            # Re-split across the heads the invoice already carries, not
            # heads re-derived from the client's state today.
            split = split_tax(0.0, tax, invoice.tax_kind)
            invoice.total_igst_amount = split.igst_amount
            invoice.total_cgst_amount = split.cgst_amount
            invoice.total_sgst_amount = split.sgst_amount
        # Invoices raised before tax_kind existed keep their (all-zero) heads:
        # they never had a split, and services/invoice_pdf.py derives one from
        # the two GSTINs at render time for exactly those.

        await invoice.save()
        updated += 1

    return updated
