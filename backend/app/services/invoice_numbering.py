# Formats the counter-generated invoice_no/purchase_invoice_no ints into the
# type-prefixed strings shown to users (table cells, PDF headers, PDF
# filenames). Kept in one place so the prefix convention is never
# reimplemented ad hoc on the frontend or in a PDF renderer.
from app.models.invoice_details import InvoiceType

_SALES_INVOICE_PREFIXES = {
    InvoiceType.standard: "SINV",
    InvoiceType.proforma: "PROF",
}


def format_sales_invoice_no(invoice_no: int, invoice_type: InvoiceType) -> str:
    return f"{_SALES_INVOICE_PREFIXES[invoice_type]}-{invoice_no:04d}"


def format_purchase_invoice_no(purchase_invoice_no: int) -> str:
    return f"PINV-{purchase_invoice_no:04d}"


# Printing purchases run their own series off their own counter (see
# models/printing_purchase_invoice_no_counter_master.py), so PPINV-0001 and
# PINV-0001 can both exist and the prefix is what says which is which.
def format_printing_purchase_invoice_no(printing_purchase_invoice_no: int) -> str:
    return f"PPINV-{printing_purchase_invoice_no:04d}"
