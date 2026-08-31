# Schema for the #quotation_details collection.
from datetime import datetime
from enum import Enum

from beanie import Document


class QuotationStatus(str, Enum):
    draft = "draft"
    sent = "sent"
    accepted = "accepted"
    rejected = "rejected"
    expired = "expired"


class QuotationDetails(Document):
    id: int
    quotation_no: int
    date: datetime  # Issue date, set/edited by the admin via the form.
    valid_till: datetime  # Defaults client-side to `date` + 10 days, editable.
    # The buyer is either an existing client or a one-off typed straight into
    # this quotation — exactly one of cust_id / customer_name is ever set
    # (enforced by schemas/quotations.py). A one-off buyer is deliberately
    # NOT written to #customer_details: it exists only on this quotation, so
    # its name/address are snapshotted here rather than joined at PDF time.
    # cust_id stays the normal path, and a real client's details keep being
    # read live off CustomerDetails so an address correction there still
    # flows into a re-downloaded PDF.
    cust_id: int | None = None  # FK -> CustomerDetails.id
    customer_name: str = ""
    customer_address: str = ""
    status: QuotationStatus = QuotationStatus.draft
    # A quotation carries its own line items (see QuotationSummary) rather
    # than borrowing them from a sales order, so — unlike InvoiceDetails — it
    # stores its own totals computed straight from those line items, same
    # convention as SalesOrders/PurchaseOrders.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str = ""
    is_deleted: bool = False

    class Settings:
        name = "quotation_details"
