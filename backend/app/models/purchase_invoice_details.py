# Schema for the #purchase_invoice_details collection.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel

from app.services.gst import TaxKind


class PurchaseInvoiceDetails(Document):
    id: int
    purchase_invoice_no: int
    date: datetime
    vendor_id: int  # FK -> VendorDetails.id, snapshotted from the linked PurchaseOrders at create time
    po_id: int  # FK -> PurchaseOrders.id — every purchase invoice is raised against a purchase order
    # The vendor's own invoice number as printed on their PDF, when the
    # purchase order was created by uploading one (see routes/orders.py's
    # parse_purchase_invoice_pdf). None for orders keyed in by hand, which
    # carry no vendor document. Together with vendor_id this is what makes
    # re-uploading the same invoice a conflict rather than a second purchase
    # order — see _reject_if_already_recorded in
    # services/purchase_invoice_intake.py.
    vendor_invoice_no: str | None = None
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
    # The GST heads this invoice is raised under, snapshotted from the
    # linked PurchaseOrders row's sgst_perc/cgst_perc/igst_perc (which the
    # order form fills in from our state vs the vendor's — see
    # services/gst.py's tax_kind_for). Stored here so the rendered PDF
    # states the heads the order was actually placed under, rather than
    # re-deciding them from the two GSTINs and possibly disagreeing with
    # the order. None for invoices raised before this existed —
    # services/invoice_pdf.py falls back to the GSTINs for those, exactly
    # as it always did.
    tax_kind: TaxKind | None = None
    # The vendor's state at the time of the invoice, for the "Place of
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
    is_deleted: bool = False

    class Settings:
        name = "purchase_invoice_details"
        # One live record per (vendor, their invoice number) — the database's
        # own version of _reject_if_already_recorded in
        # services/purchase_invoice_intake.py, which reads before it writes
        # and so can't be relied on alone.
        #
        # Partial, on both counts that rule already makes:
        #   - is_deleted False, because voiding an invoice is how an admin
        #     corrects a bad upload and has to leave it re-uploadable.
        #   - vendor_invoice_no an actual string, because orders keyed in by
        #     hand carry no vendor document and store null here — without
        #     this every one of them after the first would collide with the
        #     rest.
        indexes = [
            IndexModel(
                [("vendor_id", 1), ("vendor_invoice_no", 1)],
                unique=True,
                name="vendor_invoice_no_unique",
                partialFilterExpression={
                    "is_deleted": False,
                    "vendor_invoice_no": {"$type": "string"},
                },
            ),
        ]