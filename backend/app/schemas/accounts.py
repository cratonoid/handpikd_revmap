# Request/response bodies for the accounts module's endpoints.
#
# Every figure here is DERIVED — nothing in this file is stored. The accounts
# module is read-only reporting over the invoice/order/costing collections
# that the rest of the app writes, so there is no create/update request body
# to define, only response shapes.
#
# Money conventions used throughout, matching the rest of the backend:
#   - "revenue"/"taxable value" figures are NET of tax and net of any
#     discount (sales order totals already have the discount taken off — see
#     _compute_line_items_and_totals in routes/sales_orders.py).
#   - Percentages are whole numbers (12.5 means 12.5%), never fractions.
from datetime import date

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Overview / P&L
# ---------------------------------------------------------------------------
class AccountsTrendPoint(BaseModel):
    # Calendar month bucket, "YYYY-MM". Months with no invoices are still
    # emitted (as zeroes) so the frontend can draw a continuous line without
    # having to fill gaps itself.
    period: str
    label: str  # e.g. "Jan 2026"
    revenue: float
    cost: float
    profit: float
    invoice_count: int


class AccountsTopClient(BaseModel):
    cust_id: int
    customer_name: str
    invoice_count: int
    revenue: float
    cost: float
    profit: float
    # False when at least one sales order behind this client's invoices has
    # no costing entered, which makes `cost` (and therefore `profit`) an
    # understatement rather than a real figure.
    is_fully_costed: bool


class AccountsOverviewResponse(BaseModel):
    revenue: float  # Net of tax — tax collected is not income.
    tax_collected: float
    total_billed: float  # revenue + tax_collected, i.e. what customers owe.
    cost_of_goods: float
    gross_profit: float
    gross_margin_perc: float
    invoice_count: int
    average_invoice_value: float
    # Costing coverage, so the UI can warn that margin is incomplete rather
    # than presenting an understated cost as fact. Counted over the distinct
    # sales orders behind the invoices in range.
    sales_orders_in_range: int
    sales_orders_costed: int
    trend: list[AccountsTrendPoint]
    top_clients: list[AccountsTopClient]


# ---------------------------------------------------------------------------
# Receivables
# ---------------------------------------------------------------------------
class ReceivableAgingBucket(BaseModel):
    key: str  # "not_due" | "d0_30" | "d31_60" | "d61_90" | "d90_plus"
    label: str
    invoice_count: int
    amount: float


class ReceivableClientRow(BaseModel):
    cust_id: int
    customer_name: str
    invoice_count: int
    outstanding: float
    overdue: float
    # 0 when this client has nothing past its due date.
    oldest_overdue_days: int


class ReceivableInvoiceRow(BaseModel):
    id: int
    invoice_no_display: str
    date: date
    due_date: date
    customer_name: str
    amount: float
    status: str
    # Negative would mean "not due yet", so it is clamped to 0 and the
    # not-yet-due case is read off the aging bucket instead.
    days_overdue: int


class AccountsReceivablesResponse(BaseModel):
    # The day the aging was computed against (server "today"), which is what
    # days_overdue and the buckets are relative to — NOT the range end.
    as_of: date
    total_outstanding: float
    overdue_amount: float
    outstanding_invoice_count: int
    overdue_invoice_count: int
    # Standard invoices dated in range whose status is already `paid`. Gives
    # the range a "money that came in" counterpart to the outstanding figure.
    collected_in_range: float
    paid_invoice_count: int
    # Weighted by nothing — a plain mean over the overdue invoices only.
    average_days_overdue: float
    aging: list[ReceivableAgingBucket]
    clients: list[ReceivableClientRow]
    invoices: list[ReceivableInvoiceRow]


# ---------------------------------------------------------------------------
# Tax / GST
# ---------------------------------------------------------------------------
class TaxPeriodRow(BaseModel):
    period: str  # "YYYY-MM"
    label: str
    output_tax: float
    input_tax: float
    net_liability: float


class AccountsTaxSummaryResponse(BaseModel):
    # Output side — tax charged to customers on standard sales invoices.
    # The split comes from each invoice's own total_sgst/cgst/igst_amount,
    # frozen when it was raised from the client's state vs ours (see
    # models/invoice_details.py).
    output_tax: float
    output_taxable_value: float
    output_invoice_count: int
    output_sgst: float
    output_cgst: float
    output_igst: float
    # Tax on invoices raised before the split was stored — real output tax,
    # but not attributable to a head without re-deriving it from the two
    # GSTINs as they stand today, which is exactly what freezing the split
    # was meant to stop.
    output_unclassified: float
    # Input side — tax paid to vendors on purchase invoices. The split comes
    # from the linked PurchaseOrders' sgst_perc/cgst_perc/igst_perc, which
    # are mutually exclusive by Indian GST rules (see models/purchase_orders.py).
    input_tax: float
    input_taxable_value: float
    input_invoice_count: int
    input_sgst: float
    input_cgst: float
    input_igst: float
    # Tax on purchase invoices whose purchase order is missing or carries no
    # percentages at all — real input tax, but not attributable to a head.
    input_unclassified: float
    # Positive = payable to the department, negative = credit carried forward.
    net_liability: float
    periods: list[TaxPeriodRow]
