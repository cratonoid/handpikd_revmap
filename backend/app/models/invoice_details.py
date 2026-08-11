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


class InvoiceDetails(Document):
    id: int
    invoice_no: int
    date: datetime
    # Standard invoices ride on a SalesOrders row (sales_id); their
    # customer/line items are derived from that row. Proforma invoices are
    # raised by hand, like a quotation — own line items (ProformaInvoiceSummary,
    # keyed by invoice_id) and own cust_id, no sales order or quotation
    # involved.
    sales_id: int | None = None  # FK -> SalesOrders.id (standard only)
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
    type: InvoiceType
    due_date: datetime
    online_or_offline: OnlineOrOffline
    transport: str = ""  # e.g. "Hand Delivery" — shipping mode, invoice-specific.
    description: str = ""  # Scope/description shown on a proforma invoice PDF; unused by standard invoices.
    is_deleted: bool = False

    class Settings:
        name = "invoice_details"
