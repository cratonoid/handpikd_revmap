# Schema for the #invoice_details collection.
from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import BaseModel

from app.services.gst import TaxKind


class InvoiceType(str, Enum):
    proforma = "proforma"
    standard = "standard"


# Standard invoices only. A "full" invoice bills its sales orders outright —
# or, when partial invoices were raised against them first, whatever those
# left: the orders' totals less every live partial's. A "partial" invoice
# bills an advance against the orders, set either as a percentage of their
# value (partial_percent) or as a fixed amount including tax
# (partial_amount); exactly one of the two is set. Any number of partials may
# sit on the same orders as long as together they don't exceed the orders'
# value, and all of them, plus the full invoice that closes them out, must
# list the very same orders (see services/invoice_totals.py). Rows raised
# before this existed read as "full".
class InvoiceBilling(str, Enum):
    full = "full"
    partial = "partial"


class OnlineOrOffline(str, Enum):
    online = "online"
    offline = "offline"


# Payment state, and only payment state. #invoice_details has no
# part-payment field, so an invoice is either fully outstanding or fully
# settled. The earlier "new"/"submitted" pair tracked how far the document
# had got (raised, then sent to the client) rather than whether the money had
# arrived, which left the books with two statuses meaning one thing. Legacy
# rows carrying either are folded into `unpaid` by
# scripts/migrate_invoice_status_to_unpaid_paid.py.
class InvoiceStatus(str, Enum):
    unpaid = "unpaid"
    paid = "paid"


# Where a standard invoice is in its life. A draft is a working copy: freely
# editable (billing included), re-totalled whenever its sales orders change,
# numberless, watermarked DRAFT on its PDF, deletable, and invisible to the
# books and the client portal. Issuing it (POST /admin/issue_invoice) draws
# its number from the financial-year series and freezes it: its totals, GST
# heads, line items and party details are copied onto the row (issued_lines/
# issued_party) and nothing but its payment state, or cancelling it, changes
# after that. Proforma invoices aren't statutory documents and have no draft
# stage, so they are always "issued". Rows raised before drafts existed read
# as issued too, which is what they were.
class InvoiceState(str, Enum):
    draft = "draft"
    issued = "issued"


# A Mongo filter that leaves drafts out. Written as {"$ne": "draft"} rather
# than state == issued so it also matches rows that predate the field and
# don't store it at all.
NOT_DRAFT = {"state": {"$ne": InvoiceState.draft.value}}


class IssuedInvoiceLine(BaseModel):
    """One row of the invoice grid as it printed the moment it was issued.

    Same fields as services/invoice_pdf.py's InvoiceLineItem, which is what
    these are converted back into for a reprint.
    """

    product_name: str
    hsn_code: str = ""
    quantity: int = 0
    rate: float = 0.0
    discount: float = 0.0
    taxable_value: float = 0.0
    tax_perc: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    is_charge: bool = False
    is_adjustment: bool = False


class IssuedInvoiceParty(BaseModel):
    """The billed-to block as it stood when the invoice was issued."""

    name: str = ""
    address: str = ""
    phone: str = ""
    gstin: str = ""


class InvoiceDetails(Document):
    id: int
    # None only on a draft: the number is drawn when it is issued, so a
    # deleted draft never leaves a gap in the GST series.
    invoice_no: int | None = None
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
    billing: InvoiceBilling = InvoiceBilling.full
    # Partial invoices only, one or the other — see InvoiceBilling. A
    # percentage keeps scaling with the orders if they're edited later; a
    # fixed amount stays that amount.
    partial_percent: float | None = None
    partial_amount: float | None = None
    # The Indian financial year (stored as the year it starts in: 2026 for
    # FY 2026-27) whose series this invoice's invoice_no was drawn from �
    # standard invoices only, since they alone are numbered per financial
    # year (H/26-27/12, see services/invoice_numbering.py). Frozen here at
    # creation time rather than re-derived from `date`, which stays editable:
    # correcting an issued invoice's date must not renumber it. None on rows
    # raised before the series became year-scoped, and on every proforma.
    invoice_fy_start_year: int | None = None
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""  # e.g. "Hand Delivery" — shipping mode, invoice-specific.
    status: InvoiceStatus = InvoiceStatus.unpaid
    # The day the payment came in, stored as midnight (Mongo has no plain
    # date type). Filled with today automatically when the invoice is marked
    # paid, editable afterwards, and cleared when it goes back to unpaid —
    # so it is set exactly when status is paid. None on invoices marked paid
    # before this field existed, until someone enters the date.
    paid_on: datetime | None = None
    description: str = ""  # Scope/description shown on a proforma invoice PDF; unused by standard invoices.
    # Free-text note for this one invoice, printed on the PDF (above Terms
    # and Conditions on a standard invoice, above the "Please Note" block on
    # a proforma) and so visible to the client, including through the portal
    # download. Distinct from the personal-details invoice_tnc/
    # quotation_notes wording, which is the same boilerplate on every
    # document — this is what's true of this invoice alone ("PO ref 4471",
    # "delivered in two lots"). Blank on rows raised before it existed, and
    # blank prints nothing at all rather than an empty heading.
    notes: str = ""
    # What the admin invoices page shows as "Cancelled". The invoice stays on
    # that page with its number, but every money figure, the bulk download and
    # the client portal leave it out, and it no longer claims its sales orders.
    is_deleted: bool = False
    # True while this invoice is void only because a sales order on it was
    # cancelled, which is what lets un-cancelling that order bring it back
    # without also reviving one an admin voided on purpose. See
    # restore_invoices_voided_by_cancellation in services/invoice_totals.py.
    voided_by_cancellation: bool = False
    # See InvoiceState. New standard invoices start as drafts (set explicitly
    # in create_new_invoice); the default is what every older row was.
    state: InvoiceState = InvoiceState.issued
    issued_at: datetime | None = None
    # The issuing user's name (or mail), for the audit trail. Blank on rows
    # issued before this existed, or with auth disabled.
    issued_by: str = ""
    # The frozen grid and party block printed on an issued standard invoice
    # (see InvoiceState). None on drafts, on proforma invoices, and on an
    # issued row the backfill (scripts/migrate_invoice_draft_state.py)
    # couldn't snapshot, all of which render from live data.
    issued_lines: list[IssuedInvoiceLine] | None = None
    issued_party: IssuedInvoiceParty | None = None

    class Settings:
        name = "invoice_details"
