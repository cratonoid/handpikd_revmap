# Request/response bodies for the client portal's invoice endpoints
# (routes/customer_invoices.py).
#
# Deliberately narrower than the admin module's InvoiceDetailItem: a client
# is shown what appears on their own document (numbers, dates, line items,
# the GST split) and nothing about how it was assembled internally —
# sales_ids, quotation_id, cust_id and is_deleted all stay on the admin side.
from datetime import datetime

from pydantic import BaseModel

from app.models.invoice_details import InvoiceStatus, InvoiceType
from app.services.gst import TaxKind


class CustomerInvoiceListItem(BaseModel):
    id: int
    invoice_no_display: str
    date: datetime
    due_date: datetime
    type: InvoiceType
    # Where the invoice stands in the admin's books: "new" (raised),
    # "submitted" (sent to the client) or "paid". Shown as-is so a client can
    # tell a settled invoice from an outstanding one.
    status: InvoiceStatus
    # Human-readable order numbers ("SO-14") behind a standard invoice, so a
    # client can tie it back to an order they placed. Empty for proforma
    # invoices, which are raised without an order.
    sales_order_nos: list[int]
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float


class CustomerInvoiceLineItem(BaseModel):
    """One row of the invoice, in the same shape for both invoice types.

    Standard invoices bill against #sales_summary (which stores a gross rate
    but a net total, hence the separate discount/taxable_value — see
    line_discount_and_taxable_value in routes/invoices.py); proforma invoices
    bill against #proforma_invoice_summary, which carries no discount at all.
    Both are flattened to this one shape so the portal renders a single table.
    """

    product_name: str
    hsn_code: str
    quantity: int
    rate: float
    discount: float
    taxable_value: float
    tax_perc: float
    tax_amount: float
    total: float


class CustomerInvoiceDetail(CustomerInvoiceListItem):
    transport: str
    description: str
    line_items: list[CustomerInvoiceLineItem]
    # The GST heads this invoice was raised under, frozen on the invoice at
    # creation time (see InvoiceDetails.tax_kind). None on rows raised before
    # that field existed — the portal falls back to showing whichever of the
    # three amounts below is non-zero.
    tax_kind: TaxKind | None
    place_of_supply_code: str
    place_of_supply_name: str
    total_igst_amount: float
    total_cgst_amount: float
    total_sgst_amount: float
    # Who the invoice is billed to, as printed on the PDF. Echoed back so the
    # client can check the details on file are the ones they want invoiced.
    billed_to_name: str
    billed_to_address: str
    billed_to_gstin: str
