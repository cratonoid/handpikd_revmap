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
    cust_id: int  # FK -> CustomerDetails.id
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
