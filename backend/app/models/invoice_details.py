# Schema for the #invoice_details collection.
from datetime import datetime
from enum import Enum

from beanie import Document

from app.services.gst import TaxKind


class InvoiceType(str, Enum):
    proforma = "proforma"
    standard = "standard"


class OnlineOrOffline(str, Enum):
    online = "online"
    offline = "offline"


class InvoiceStatus(str, Enum):
    new = "new"
    submitted = "submitted"
    paid = "paid"


class InvoiceDetails(Document):
    id: int
    invoice_no: int
    date: datetime
    # Standard invoices ride on one or more SalesOrders rows (sales_ids);
    # their customer/line items are derived from those rows (all of which
    # must share the same cust_id — enforced in create_new_invoice). Proforma
    # invoices are raised by hand, like a quotation — own line items
    # (ProformaInvoiceSummary, keyed by invoice_id) and own cust_id, no sales
    # order or quotation involved.
    sales_ids: list[int] = []  # FK -> SalesOrders.id (array, standard only)
    # Legacy-only: earlier proforma invoices were auto-generated from an
    # accepted QuotationDetails row and this pointed at it. New proforma
    # invoices never set it.
    quotation_id: int | None = None  # FK -> QuotationDetails.id
    cust_id: int | None = None  # FK -> CustomerDetails.id (proforma only)
    # Snapshotted from the linked SalesOrders row (standard) or computed
    # from ProformaInvoiceSummary line items (proforma) at create/update
    # time, same convention as SalesOrders/PurchaseOrders storing their own
    # totals rather than always recomputing from line items.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    # The GST heads this invoice is raised under, frozen at create/update
    # time from the two parties' state codes (see services/gst.py's
    # tax_kind_for): "cgst_sgst" when both sit in the same state,
    # "igst" otherwise. Stored rather than recomputed at render time so
    # correcting a party's state later can't silently restate an invoice
    # that has already gone out. None for invoices raised before this
    # existed — services/invoice_pdf.py falls back to deciding from the two
    # GSTINs for those, exactly as it always did.
    tax_kind: TaxKind | None = None
    # The buyer's state at the time of the invoice, for the "Place of
    # Supply" line. Snapshotted for the same reason as tax_kind.
    place_of_supply_code: str = ""
    place_of_supply_name: str = ""
    # total_tax_amount split across the heads tax_kind names: either
    # igst alone, or cgst and sgst at half each. They always sum to
    # total_tax_amount, so the accounts screens can total a head directly
    # instead of re-deriving the split per invoice.
    total_igst_amount: float = 0.0
    total_cgst_amount: float = 0.0
    total_sgst_amount: float = 0.0
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""  # e.g. "Hand Delivery" — shipping mode, invoice-specific.
    status: InvoiceStatus = InvoiceStatus.new
    description: str = ""  # Scope/description shown on a proforma invoice PDF; unused by standard invoices.
    is_deleted: bool = False

    class Settings:
        name = "invoice_details"
