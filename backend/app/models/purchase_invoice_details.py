# Schema for the #purchase_invoice_details collection.
from datetime import datetime

from beanie import Document


class PurchaseInvoiceDetails(Document):
    id: int
    purchase_invoice_no: int
    date: datetime
    vendor_id: int  # FK -> VendorDetails.id, snapshotted from the linked PurchaseOrders at create time
    po_id: int  # FK -> PurchaseOrders.id — every purchase invoice is raised against a purchase order
    # Original vendor PDF for this invoice, if one has been uploaded (see
    # purchase_invoice_storage.py). Optional and independent of the rest of
    # the record: an invoice can be raised from its PO alone and have a PDF
    # attached later, or never. Re-uploading replaces this (the old file is
    # hard-deleted from disk — see attach_purchase_invoice_pdf in
    # routes/purchase_invoices.py) rather than keeping history. Our own
    # rendered PDF is generated on demand, not cached, same as
    # InvoiceDetails/invoice_pdf.py.
    uploaded_pdf_path: str | None = None
    # Snapshotted at create time from the linked PurchaseOrders — same
    # convention as InvoiceDetails/SalesOrders/PurchaseOrders. Line items
    # themselves are never stored here; they're derived live from
    # PurchaseSummary via po_id, same as InvoiceDetails borrows from
    # SalesSummary.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    is_deleted: bool = False

    class Settings:
        name = "purchase_invoice_details"