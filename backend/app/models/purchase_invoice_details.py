# Schema for the #purchase_invoice_details collection.
from datetime import datetime
from enum import Enum

from beanie import Document


class PurchaseInvoiceSource(str, Enum):
    po_dropdown = "po_dropdown"
    pdf_upload = "pdf_upload"


class PurchaseInvoiceDetails(Document):
    id: int
    purchase_invoice_no: int
    date: datetime
    vendor_id: int  # FK -> VendorDetails.id
    po_id: int | None = None  # FK -> PurchaseOrders.id, optional either way
    source: PurchaseInvoiceSource
    # Only set when source == pdf_upload: relative path to the original
    # vendor PDF, served back as-is (see purchase_invoice_storage.py). Our
    # own rendered PDF is generated on demand, not cached, same as
    # InvoiceDetails/invoice_pdf.py.
    uploaded_pdf_path: str | None = None
    # Snapshotted at create/update time, same convention as
    # InvoiceDetails/SalesOrders/PurchaseOrders. Line items themselves are
    # NOT stored here for source == po_dropdown (derived live from
    # PurchaseSummary via po_id, same as InvoiceDetails borrows from
    # SalesSummary); for source == pdf_upload they live in
    # PurchaseInvoiceSummary since there's no source-of-truth order to
    # re-derive from.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool = False

    class Settings:
        name = "purchase_invoice_details"
