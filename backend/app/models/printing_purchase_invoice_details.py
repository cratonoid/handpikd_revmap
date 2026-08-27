# Schema for the #printing_purchase_invoice_details collection.
#
# The printing counterpart of PurchaseInvoiceDetails, raised against a
# PrintingPurchaseOrders row the same way that one is raised against a
# PurchaseOrders row. Two differences from the material record, both
# deliberate:
#   - Its number comes from its own counter and renders as PPINV-nnnn (see
#     format_printing_purchase_invoice_no in services/invoice_numbering.py),
#     so the two series never have to be told apart by which collection a
#     number came out of.
#   - There is no branded PDF for it. A printing purchase invoice is a record
#     of the vendor's own document, so uploaded_pdf_path is the only PDF it
#     has — routes/printing_purchase_invoices.py serves that and generates
#     nothing.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel

from app.services.gst import TaxKind


class PrintingPurchaseInvoiceDetails(Document):
    id: int
    printing_purchase_invoice_no: int
    date: datetime
    vendor_id: int  # FK -> VendorDetails.id, snapshotted from the linked PrintingPurchaseOrders at create time
    po_id: int  # FK -> PrintingPurchaseOrders.id — every printing purchase invoice is raised against one
    # The vendor's own invoice number as printed on their PDF, when the order
    # was created by uploading one. None for orders keyed in by hand, which
    # carry no vendor document. Together with vendor_id this is what makes
    # re-uploading the same invoice a conflict — see
    # _reject_if_already_recorded in
    # services/printing_purchase_invoice_intake.py.
    vendor_invoice_no: str | None = None
    # The vendor's own PDF, if one has been uploaded (see
    # purchase_invoice_storage.py — printing shares the material side's
    # storage, since the files are the same kind of private vendor document).
    # Unlike the material record this is the ONLY PDF this invoice has.
    # Re-uploading replaces it and hard-deletes the old file rather than
    # keeping history.
    uploaded_pdf_path: str | None = None
    # Snapshotted at create time from the linked PrintingPurchaseOrders. Line
    # items are never stored here; they're read live from
    # PrintingPurchaseSummary via po_id.
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    # The heads this invoice is raised under and the vendor's state at the
    # time, snapshotted from the order for the same reason as on
    # PurchaseInvoiceDetails: so the record states the heads the order was
    # actually placed under rather than re-deciding them later. Never None —
    # there are no rows here predating the field.
    tax_kind: TaxKind
    place_of_supply_code: str = ""
    place_of_supply_name: str = ""
    # total_tax_amount split across the heads tax_kind names: either igst
    # alone, or cgst and sgst at half each. They always sum to
    # total_tax_amount, so the accounts screens can total a head directly.
    total_igst_amount: float = 0.0
    total_cgst_amount: float = 0.0
    total_sgst_amount: float = 0.0
    is_deleted: bool = False

    class Settings:
        name = "printing_purchase_invoice_details"
        # One live record per (vendor, their invoice number) — the database's
        # own version of the check in
        # services/printing_purchase_invoice_intake.py, which reads before it
        # writes and so can't be relied on alone. Partial on both counts that
        # rule makes, exactly as on PurchaseInvoiceDetails: voided invoices
        # are excluded so a bad upload can be corrected and re-uploaded, and
        # rows with a null vendor_invoice_no (orders keyed in by hand) are
        # excluded so they don't all collide with each other.
        indexes = [
            IndexModel(
                [("vendor_id", 1), ("vendor_invoice_no", 1)],
                unique=True,
                name="printing_vendor_invoice_no_unique",
                partialFilterExpression={
                    "is_deleted": False,
                    "vendor_invoice_no": {"$type": "string"},
                },
            ),
        ]
