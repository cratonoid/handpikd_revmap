# Formats the counter-generated invoice_no/purchase_invoice_no ints into the
# strings shown to users (table cells, PDF headers, PDF filenames). Kept in
# one place so the numbering convention is never reimplemented ad hoc on the
# frontend or in a PDF renderer.
from datetime import date, datetime

from app.models.invoice_details import InvoiceDetails, InvoiceType

# Standard (tax) invoices run a series scoped to the Indian financial year —
# H/26-27/12 is the twelfth tax invoice of FY 2026-27 — so the number restarts
# at 1 every 1 April. The financial year an invoice belongs to is frozen on
# the row at creation time (InvoiceDetails.invoice_fy_start_year) rather than
# re-derived from its date on every render: the date is editable after the
# fact, and an already-issued invoice must not change its number (or start
# colliding with another year's) because someone corrected it.
_STANDARD_SERIES_LETTER = "H"
# Proforma invoices keep the flat, visibly different series: they are not
# statutory invoices and must not read like one.
_PROFORMA_INVOICE_PREFIX = "PROF"


def financial_year_start_year(when: date | datetime) -> int:
    """The calendar year the Indian financial year (1 Apr - 31 Mar) containing `when` starts in."""
    return when.year if when.month >= 4 else when.year - 1


def financial_year_label(fy_start_year: int) -> str:
    """2026 -> "26-27"."""
    return f"{fy_start_year % 100:02d}-{(fy_start_year + 1) % 100:02d}"


def format_standard_invoice_no(invoice_no: int, fy_start_year: int) -> str:
    return f"{_STANDARD_SERIES_LETTER}/{financial_year_label(fy_start_year)}/{invoice_no}"


def format_sales_invoice_no(invoice: InvoiceDetails) -> str:
    if invoice.type == InvoiceType.proforma:
        return f"{_PROFORMA_INVOICE_PREFIX}-{invoice.invoice_no:04d}"

    # invoice_fy_start_year is None only on standard rows raised before the
    # series became financial-year-scoped and not yet backfilled by
    # scripts/migrate_standard_invoice_no_to_fy_series.py. The invoice date is
    # exactly what that migration seeds the field from, so fall back to it.
    fy_start_year = invoice.invoice_fy_start_year
    if fy_start_year is None:
        fy_start_year = financial_year_start_year(invoice.date)
    return format_standard_invoice_no(invoice.invoice_no, fy_start_year)


def invoice_no_filename_slug(invoice_no_display: str) -> str:
    # H/26-27/12 contains path separators. Left in a PDF filename they break
    # the Content-Disposition name, and left in a zip entry name they turn one
    # invoice into two nested directories.
    return invoice_no_display.replace("/", "-")


def format_purchase_invoice_no(purchase_invoice_no: int) -> str:
    return f"PINV-{purchase_invoice_no:04d}"


# Printing purchases run their own series off their own counter (see
# models/printing_purchase_invoice_no_counter_master.py), so PPINV-0001 and
# PINV-0001 can both exist and the prefix is what says which is which.
def format_printing_purchase_invoice_no(printing_purchase_invoice_no: int) -> str:
    return f"PPINV-{printing_purchase_invoice_no:04d}"
