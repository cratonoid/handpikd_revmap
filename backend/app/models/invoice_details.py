# Schema for the #invoice_details collection.
from datetime import datetime
from enum import Enum

from beanie import Document


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
    # Exactly one of sales_id/quotation_id is set, matching `type`:
    # standard invoices ride on a SalesOrders row (sales_id), proforma
    # invoices are auto-generated straight from an accepted QuotationDetails
    # row (quotation_id) since no sales order exists yet at that point.
    sales_id: int | None = None  # FK -> SalesOrders.id
    quotation_id: int | None = None  # FK -> QuotationDetails.id
    # Snapshotted from the linked SalesOrders/QuotationDetails at
    # create/update time, same convention as SalesOrders/PurchaseOrders
    # storing their own totals rather than always recomputing from line
    # items.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""  # e.g. "Hand Delivery" — shipping mode, invoice-specific.
    status: InvoiceStatus = InvoiceStatus.new
    is_deleted: bool = False

    class Settings:
        name = "invoice_details"
