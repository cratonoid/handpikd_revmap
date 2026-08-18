# Accounts module: read-only finance reporting over a date range, backing the
# admin's /admin/accounts page (frontend components/admin/
# accounts-page-client.tsx and its three tabs). Restricted to admins
# (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
#
# Nothing here writes. Every figure is derived on each request from the
# collections the operational modules already maintain — there is no
# "accounts" collection and deliberately no cached/posted ledger, because a
# second stored copy of these numbers would be one more thing to keep in sync
# with an edited invoice or a re-costed order.
#
# ---------------------------------------------------------------------------
# What counts as revenue
# ---------------------------------------------------------------------------
# STANDARD invoices only, bucketed by the invoice's own date field,
# regardless of payment status (accrual basis). Proforma invoices are
# excluded throughout: they are advance-payment requests raised by hand like
# a quotation, and a proforma that later becomes a standard invoice would
# otherwise be counted twice. This matches get_invoices_pdf_zip in
# routes/invoices.py, which is also standard-only and also keys off date
# rather than due_date.
#
# Revenue is taken NET of tax (InvoiceDetails.total_amount_before_tax) — GST
# collected is money held for the department, not income. It is also already
# net of any line discount, because the sales order totals the invoice
# snapshots are computed that way (see _compute_line_items_and_totals in
# routes/sales_orders.py).
#
# ---------------------------------------------------------------------------
# What counts as cost
# ---------------------------------------------------------------------------
# The cost side comes from #sales_order_costing, NOT from purchase invoices:
# purchases are raised against vendors on their own schedule and cannot be
# matched to the sales invoice they were bought for, whereas costing rows are
# keyed to the very sales order being invoiced. The per-line figure used is
# net final cost, defined identically to computeCostingFigures in
# frontend/src/lib/sales-order-costing.ts — purchase and printing TAX are
# excluded from it, since those are reclaimable input credit rather than real
# cost (they surface separately on the tax tab instead).
#
# Costing is optional in the UI, so an order may have no costing rows at all.
# Rather than guess, such an order contributes zero cost and is counted in
# sales_orders_in_range but not sales_orders_costed, letting the frontend
# tell the admin the margin is incomplete instead of quietly understating it.
from collections import defaultdict
from datetime import date, datetime, time

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    InvoiceDetails,
    InvoiceStatus,
    InvoiceType,
    PrintingCost,
    PurchaseInvoiceDetails,
    PurchaseOrders,
    SalesOrderCosting,
    SalesOrders,
    SalesSummary,
    User,
)
from app.schemas.accounts import (
    AccountsOverviewResponse,
    AccountsReceivablesResponse,
    AccountsTaxSummaryResponse,
    AccountsTopClient,
    AccountsTrendPoint,
    ReceivableAgingBucket,
    ReceivableClientRow,
    ReceivableInvoiceRow,
    TaxPeriodRow,
)
from app.services.invoice_numbering import format_sales_invoice_no

router = APIRouter(prefix="/admin", tags=["accounts"])

# Invoices that still owe money. "paid" is the only terminal status, so
# receivables is everything else — the same split analytics.py's
# _UNPAID_INVOICE_STATUSES makes for the dashboard's unpaid count.
_UNPAID_INVOICE_STATUSES = [InvoiceStatus.new, InvoiceStatus.submitted]

# Only the top few clients are worth a table on an overview tab; the full
# per-client picture lives on the receivables tab.
_TOP_CLIENTS_LIMIT = 8

_MONTH_LABELS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

# Upper bound on how many monthly buckets a single request will emit. A
# mistyped year in the date picker (0202-01-01) would otherwise ask for
# ~20,000 buckets and hand the browser a chart it cannot draw.
_MAX_TREND_MONTHS = 120


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _validate_range(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    if start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date must not be after end_date",
        )
    # time.max rather than the next day's midnight so the bound stays
    # inclusive on both ends, matching get_invoices_pdf_zip.
    return datetime.combine(start_date, time.min), datetime.combine(end_date, time.max)


def _month_key(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_label(year: int, month: int) -> str:
    return f"{_MONTH_LABELS[month - 1]} {year}"


def _month_span(start_date: date, end_date: date) -> list[tuple[str, str]]:
    # Every calendar month touched by the range, in order, so a month with no
    # activity still appears as a zero point rather than a gap in the chart.
    span: list[tuple[str, str]] = []
    year, month = start_date.year, start_date.month
    while (year, month) <= (end_date.year, end_date.month) and len(span) < _MAX_TREND_MONTHS:
        span.append((f"{year:04d}-{month:02d}", _month_label(year, month)))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return span


async def _standard_invoices_in_range(start_dt: datetime, end_dt: datetime) -> list[InvoiceDetails]:
    return await InvoiceDetails.find(
        InvoiceDetails.type == InvoiceType.standard,
        InvoiceDetails.is_deleted == False,
        InvoiceDetails.date >= start_dt,
        InvoiceDetails.date <= end_dt,
    ).to_list()


async def _customer_names(cust_ids: set[int]) -> dict[int, str]:
    if not cust_ids:
        return {}
    customers = await CustomerDetails.find(In(CustomerDetails.id, list(cust_ids))).to_list()
    return {customer.id: customer.registered_name for customer in customers}


async def _customer_id_by_sales_order(sales_order_ids: set[int]) -> dict[int, int]:
    # Standard invoices do not carry cust_id themselves — it lives on the
    # linked sales orders, all of which share one customer (enforced by
    # _check_same_customer in routes/invoices.py).
    if not sales_order_ids:
        return {}
    orders = await SalesOrders.find(In(SalesOrders.id, list(sales_order_ids))).to_list()
    return {order.id: order.cust_id for order in orders}


def _net_final_cost(
    quantity: int,
    net_purchase_rate: float,
    printing_costs: list[PrintingCost],
    delivery: float,
    miscellaneous: float,
) -> float:
    """The cost side of one costing row, for `quantity` pieces of that product.

    Mirrors computeCostingFigures' netFinalCost in
    frontend/src/lib/sales-order-costing.ts exactly: purchase rate and
    printing are per piece and scale with quantity, delivery and
    miscellaneous are flat amounts for the whole line, and neither tax figure
    is included (both are reclaimable input credit, not real cost).

    Takes the fields rather than a SalesOrderCosting so the arithmetic can be
    unit-tested without a Mongo connection — Beanie Documents cannot be
    constructed before their collection is initialized.
    """
    net_printing_rate = sum(printing.cost_per_unit for printing in printing_costs)
    return quantity * net_purchase_rate + quantity * net_printing_rate + delivery + miscellaneous


def _apportion_input_tax(
    tax: float, sgst_perc: float, cgst_perc: float, igst_perc: float
) -> tuple[float, float, float, float]:
    """Split one purchase invoice's tax into (sgst, cgst, igst, unclassified).

    The invoice's own stored tax total is authoritative; the purchase order's
    percentages only decide how it is APPORTIONED between heads. Splitting it
    this way (rather than recomputing each head from the percentages against
    the taxable value) guarantees the four figures always add back to `tax`
    exactly, even if the purchase order was edited after its invoice
    snapshotted the totals.

    Indian GST rules make the heads mutually exclusive — SGST+CGST for
    intra-state or IGST alone for inter-state, enforced in
    schemas/purchase_orders.py — but nothing here depends on that, so a
    malformed order still apportions sensibly instead of raising.
    """
    total_perc = sgst_perc + cgst_perc + igst_perc
    if total_perc <= 0:
        # No percentages recorded at all: real input tax, but not
        # attributable to a head.
        return 0.0, 0.0, 0.0, tax
    return (
        tax * sgst_perc / total_perc,
        tax * cgst_perc / total_perc,
        tax * igst_perc / total_perc,
        0.0,
    )


async def _cost_by_sales_order(sales_order_ids: set[int]) -> tuple[dict[int, float], set[int]]:
    """Net final cost per sales order, plus the ids that actually have costing.

    Returns (cost_by_order_id, costed_order_ids). An order with no
    #sales_order_costing rows is absent from both, so callers can distinguish
    "cost is genuinely zero" from "cost was never entered".
    """
    if not sales_order_ids:
        return {}, set()

    order_id_list = list(sales_order_ids)

    # Quantities are summed per (order, product) rather than read per line
    # item, because costing is keyed by product id — an order listing the
    # same product on two lines has ONE costing row covering both. See
    # models/sales_order_costing.py.
    summaries = await SalesSummary.find(In(SalesSummary.sales_order_id, order_id_list)).to_list()
    quantity_by_order_product: dict[tuple[int, int], int] = defaultdict(int)
    for summary in summaries:
        quantity_by_order_product[(summary.sales_order_id, summary.product_id)] += summary.quantity

    costings = await SalesOrderCosting.find(In(SalesOrderCosting.sales_order_id, order_id_list)).to_list()

    cost_by_order: dict[int, float] = defaultdict(float)
    costed_order_ids: set[int] = set()
    for costing in costings:
        costed_order_ids.add(costing.sales_order_id)
        quantity = quantity_by_order_product.get((costing.sales_order_id, costing.product_id), 0)
        cost_by_order[costing.sales_order_id] += _net_final_cost(
            quantity=quantity,
            net_purchase_rate=costing.net_purchase_rate,
            printing_costs=costing.printing_costs,
            delivery=costing.delivery,
            miscellaneous=costing.miscellaneous,
        )

    return dict(cost_by_order), costed_order_ids


# ---------------------------------------------------------------------------
# Overview / P&L
# ---------------------------------------------------------------------------
@router.get("/get_accounts_overview", response_model=AccountsOverviewResponse)
async def get_accounts_overview(
    start_date: date,
    end_date: date,
    _: User | None = Depends(require_admin),
) -> AccountsOverviewResponse:
    start_dt, end_dt = _validate_range(start_date, end_date)
    invoices = await _standard_invoices_in_range(start_dt, end_dt)

    # Every sales order touched by the range, gathered once so cost and
    # customer lookups are two queries rather than two per invoice.
    all_sales_order_ids = {sales_id for invoice in invoices for sales_id in invoice.sales_ids}
    cost_by_order, costed_order_ids = await _cost_by_sales_order(all_sales_order_ids)
    cust_id_by_order = await _customer_id_by_sales_order(all_sales_order_ids)

    revenue = sum(invoice.total_amount_before_tax for invoice in invoices)
    tax_collected = sum(invoice.total_tax_amount for invoice in invoices)
    total_billed = sum(invoice.total_amount_after_tax for invoice in invoices)

    # Monthly buckets, pre-seeded so months with no invoices render flat
    # rather than dropping out of the series.
    span = _month_span(start_date, end_date)
    bucket_revenue: dict[str, float] = {key: 0.0 for key, _ in span}
    bucket_cost: dict[str, float] = {key: 0.0 for key, _ in span}
    bucket_count: dict[str, int] = {key: 0 for key, _ in span}

    client_revenue: dict[int, float] = defaultdict(float)
    client_cost: dict[int, float] = defaultdict(float)
    client_invoices: dict[int, int] = defaultdict(int)
    # Clients with at least one uncosted order behind their invoices, so
    # their row can be flagged rather than shown as a confident margin.
    clients_missing_costing: set[int] = set()

    cost_of_goods = 0.0
    for invoice in invoices:
        # An order appearing on two invoices contributes its cost to both —
        # the same double count revenue already carries, since both invoices
        # snapshot that order's totals too. Consistent, so margin stays right.
        invoice_cost = sum(cost_by_order.get(sales_id, 0.0) for sales_id in invoice.sales_ids)
        cost_of_goods += invoice_cost

        key = _month_key(invoice.date)
        if key in bucket_revenue:
            bucket_revenue[key] += invoice.total_amount_before_tax
            bucket_cost[key] += invoice_cost
            bucket_count[key] += 1

        # Any of the invoice's orders gives the right customer; they all
        # share one. Skipped entirely if none of them resolved.
        cust_id = next(
            (cust_id_by_order[sales_id] for sales_id in invoice.sales_ids if sales_id in cust_id_by_order),
            None,
        )
        if cust_id is None:
            continue
        client_revenue[cust_id] += invoice.total_amount_before_tax
        client_cost[cust_id] += invoice_cost
        client_invoices[cust_id] += 1
        if any(sales_id not in costed_order_ids for sales_id in invoice.sales_ids):
            clients_missing_costing.add(cust_id)

    names = await _customer_names(set(client_revenue))
    top_clients = sorted(
        (
            AccountsTopClient(
                cust_id=cust_id,
                customer_name=names.get(cust_id, f"Client {cust_id}"),
                invoice_count=client_invoices[cust_id],
                revenue=round(client_revenue[cust_id], 2),
                cost=round(client_cost[cust_id], 2),
                profit=round(client_revenue[cust_id] - client_cost[cust_id], 2),
                is_fully_costed=cust_id not in clients_missing_costing,
            )
            for cust_id in client_revenue
        ),
        key=lambda client: client.revenue,
        reverse=True,
    )[:_TOP_CLIENTS_LIMIT]

    gross_profit = revenue - cost_of_goods
    invoice_count = len(invoices)

    return AccountsOverviewResponse(
        revenue=round(revenue, 2),
        tax_collected=round(tax_collected, 2),
        total_billed=round(total_billed, 2),
        cost_of_goods=round(cost_of_goods, 2),
        gross_profit=round(gross_profit, 2),
        gross_margin_perc=round(gross_profit / revenue * 100, 2) if revenue else 0.0,
        invoice_count=invoice_count,
        average_invoice_value=round(total_billed / invoice_count, 2) if invoice_count else 0.0,
        sales_orders_in_range=len(all_sales_order_ids),
        sales_orders_costed=len(costed_order_ids),
        trend=[
            AccountsTrendPoint(
                period=key,
                label=label,
                revenue=round(bucket_revenue[key], 2),
                cost=round(bucket_cost[key], 2),
                profit=round(bucket_revenue[key] - bucket_cost[key], 2),
                invoice_count=bucket_count[key],
            )
            for key, label in span
        ],
        top_clients=top_clients,
    )


# ---------------------------------------------------------------------------
# Receivables
# ---------------------------------------------------------------------------
_AGING_LABELS = [
    ("not_due", "Not yet due"),
    ("d0_30", "1-30 days"),
    ("d31_60", "31-60 days"),
    ("d61_90", "61-90 days"),
    ("d90_plus", "90+ days"),
]


def _aging_bucket(days_overdue: int, is_overdue: bool) -> str:
    if not is_overdue:
        return "not_due"
    if days_overdue <= 30:
        return "d0_30"
    if days_overdue <= 60:
        return "d31_60"
    if days_overdue <= 90:
        return "d61_90"
    return "d90_plus"


@router.get("/get_accounts_receivables", response_model=AccountsReceivablesResponse)
async def get_accounts_receivables(
    start_date: date,
    end_date: date,
    _: User | None = Depends(require_admin),
) -> AccountsReceivablesResponse:
    start_dt, end_dt = _validate_range(start_date, end_date)

    # Two deliberately different notions of time are in play here. The date
    # RANGE filters which invoices are in scope (those raised in the period
    # being reviewed), but the AGING is measured against today — an invoice
    # raised in January is 200 days late today no matter what range surfaced
    # it. Ageing against the range end instead would make last quarter's
    # report claim debts were current when they have since gone bad.
    as_of = date.today()

    invoices = await _standard_invoices_in_range(start_dt, end_dt)
    outstanding_invoices = [invoice for invoice in invoices if invoice.status in _UNPAID_INVOICE_STATUSES]
    paid_invoices = [invoice for invoice in invoices if invoice.status == InvoiceStatus.paid]

    sales_order_ids = {sales_id for invoice in outstanding_invoices for sales_id in invoice.sales_ids}
    cust_id_by_order = await _customer_id_by_sales_order(sales_order_ids)
    names = await _customer_names(set(cust_id_by_order.values()))

    bucket_amount: dict[str, float] = {key: 0.0 for key, _ in _AGING_LABELS}
    bucket_count: dict[str, int] = {key: 0 for key, _ in _AGING_LABELS}

    client_outstanding: dict[int, float] = defaultdict(float)
    client_overdue: dict[int, float] = defaultdict(float)
    client_count: dict[int, int] = defaultdict(int)
    client_oldest: dict[int, int] = defaultdict(int)

    rows: list[ReceivableInvoiceRow] = []
    total_outstanding = 0.0
    overdue_amount = 0.0
    overdue_days_total = 0
    overdue_invoice_count = 0

    for invoice in outstanding_invoices:
        # The full invoice value is treated as outstanding: there is no
        # part-payment field on #invoice_details, status is all-or-nothing.
        amount = invoice.total_amount_after_tax
        total_outstanding += amount

        due = invoice.due_date.date()
        is_overdue = due < as_of
        days_overdue = (as_of - due).days if is_overdue else 0

        bucket = _aging_bucket(days_overdue, is_overdue)
        bucket_amount[bucket] += amount
        bucket_count[bucket] += 1

        if is_overdue:
            overdue_amount += amount
            overdue_days_total += days_overdue
            overdue_invoice_count += 1

        cust_id = next(
            (cust_id_by_order[sales_id] for sales_id in invoice.sales_ids if sales_id in cust_id_by_order),
            None,
        )
        customer_name = names.get(cust_id, f"Client {cust_id}") if cust_id is not None else "—"
        if cust_id is not None:
            client_outstanding[cust_id] += amount
            client_count[cust_id] += 1
            if is_overdue:
                client_overdue[cust_id] += amount
                client_oldest[cust_id] = max(client_oldest[cust_id], days_overdue)

        rows.append(
            ReceivableInvoiceRow(
                id=invoice.id,
                invoice_no_display=format_sales_invoice_no(invoice.invoice_no, invoice.type),
                date=invoice.date.date(),
                due_date=due,
                customer_name=customer_name,
                amount=round(amount, 2),
                status=invoice.status.value,
                days_overdue=days_overdue,
            )
        )

    # Most overdue first — the collections worklist, top to bottom.
    rows.sort(key=lambda row: (-row.days_overdue, -row.amount))

    clients = sorted(
        (
            ReceivableClientRow(
                cust_id=cust_id,
                customer_name=names.get(cust_id, f"Client {cust_id}"),
                invoice_count=client_count[cust_id],
                outstanding=round(client_outstanding[cust_id], 2),
                overdue=round(client_overdue[cust_id], 2),
                oldest_overdue_days=client_oldest[cust_id],
            )
            for cust_id in client_outstanding
        ),
        key=lambda client: client.outstanding,
        reverse=True,
    )

    return AccountsReceivablesResponse(
        as_of=as_of,
        total_outstanding=round(total_outstanding, 2),
        overdue_amount=round(overdue_amount, 2),
        outstanding_invoice_count=len(outstanding_invoices),
        overdue_invoice_count=overdue_invoice_count,
        collected_in_range=round(sum(invoice.total_amount_after_tax for invoice in paid_invoices), 2),
        paid_invoice_count=len(paid_invoices),
        average_days_overdue=round(overdue_days_total / overdue_invoice_count, 1)
        if overdue_invoice_count
        else 0.0,
        aging=[
            ReceivableAgingBucket(
                key=key,
                label=label,
                invoice_count=bucket_count[key],
                amount=round(bucket_amount[key], 2),
            )
            for key, label in _AGING_LABELS
        ],
        clients=clients,
        invoices=rows,
    )


# ---------------------------------------------------------------------------
# Tax / GST
# ---------------------------------------------------------------------------
@router.get("/get_accounts_tax_summary", response_model=AccountsTaxSummaryResponse)
async def get_accounts_tax_summary(
    start_date: date,
    end_date: date,
    _: User | None = Depends(require_admin),
) -> AccountsTaxSummaryResponse:
    start_dt, end_dt = _validate_range(start_date, end_date)

    sales_invoices = await _standard_invoices_in_range(start_dt, end_dt)
    purchase_invoices = await PurchaseInvoiceDetails.find(
        PurchaseInvoiceDetails.is_deleted == False,
        PurchaseInvoiceDetails.date >= start_dt,
        PurchaseInvoiceDetails.date <= end_dt,
    ).to_list()

    # The SGST/CGST/IGST split lives on the purchase ORDER, not the invoice —
    # the invoice only snapshots the three totals (see
    # models/purchase_invoice_details.py).
    po_ids = {invoice.po_id for invoice in purchase_invoices}
    orders = await PurchaseOrders.find(In(PurchaseOrders.id, list(po_ids))).to_list() if po_ids else []
    orders_by_id = {order.id: order for order in orders}

    span = _month_span(start_date, end_date)
    bucket_output: dict[str, float] = {key: 0.0 for key, _ in span}
    bucket_input: dict[str, float] = {key: 0.0 for key, _ in span}

    output_tax = 0.0
    output_taxable_value = 0.0
    output_sgst = 0.0
    output_cgst = 0.0
    output_igst = 0.0
    output_unclassified = 0.0
    for invoice in sales_invoices:
        output_tax += invoice.total_tax_amount
        output_taxable_value += invoice.total_amount_before_tax
        key = _month_key(invoice.date)
        if key in bucket_output:
            bucket_output[key] += invoice.total_tax_amount

        # Unlike the input side, no apportioning is needed: the invoice
        # stores the heads it was raised under. Invoices predating that
        # (tax_kind is None) have no head on record and are reported as
        # unclassified rather than guessed at.
        if invoice.tax_kind is None:
            output_unclassified += invoice.total_tax_amount
        else:
            output_sgst += invoice.total_sgst_amount
            output_cgst += invoice.total_cgst_amount
            output_igst += invoice.total_igst_amount

    input_tax = 0.0
    input_taxable_value = 0.0
    input_sgst = 0.0
    input_cgst = 0.0
    input_igst = 0.0
    input_unclassified = 0.0

    for invoice in purchase_invoices:
        tax = invoice.total_tax_amount
        input_tax += tax
        input_taxable_value += invoice.total_amount_before_tax
        key = _month_key(invoice.date)
        if key in bucket_input:
            bucket_input[key] += tax

        # A purchase invoice whose order is missing (hard-deleted, or the id
        # never resolved) is treated the same as one with no percentages:
        # its tax is real, just not attributable to a head.
        order = orders_by_id.get(invoice.po_id)
        sgst, cgst, igst, unclassified = _apportion_input_tax(
            tax,
            (order.sgst_perc or 0.0) if order else 0.0,
            (order.cgst_perc or 0.0) if order else 0.0,
            (order.igst_perc or 0.0) if order else 0.0,
        )
        input_sgst += sgst
        input_cgst += cgst
        input_igst += igst
        input_unclassified += unclassified

    return AccountsTaxSummaryResponse(
        output_tax=round(output_tax, 2),
        output_taxable_value=round(output_taxable_value, 2),
        output_invoice_count=len(sales_invoices),
        output_sgst=round(output_sgst, 2),
        output_cgst=round(output_cgst, 2),
        output_igst=round(output_igst, 2),
        output_unclassified=round(output_unclassified, 2),
        input_tax=round(input_tax, 2),
        input_taxable_value=round(input_taxable_value, 2),
        input_invoice_count=len(purchase_invoices),
        input_sgst=round(input_sgst, 2),
        input_cgst=round(input_cgst, 2),
        input_igst=round(input_igst, 2),
        input_unclassified=round(input_unclassified, 2),
        net_liability=round(output_tax - input_tax, 2),
        periods=[
            TaxPeriodRow(
                period=key,
                label=label,
                output_tax=round(bucket_output[key], 2),
                input_tax=round(bucket_input[key], 2),
                net_liability=round(bucket_output[key] - bucket_input[key], 2),
            )
            for key, label in span
        ],
    )
