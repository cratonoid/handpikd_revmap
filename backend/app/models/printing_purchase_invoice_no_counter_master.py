# Schema for the #printing_purchase_invoice_no_counter_master collection.
#
# Its own series, separate from purchase_invoice_no_counter_master: printing
# invoices are numbered PPINV-nnnn and material ones PINV-nnnn (see
# services/invoice_numbering.py), so the two run independently and a number
# is never ambiguous about which collection it belongs to.
from beanie import Document


class PrintingPurchaseInvoiceNoCounterMaster(Document):
    id: int
    next_printing_purchase_invoice_no: int

    class Settings:
        name = "printing_purchase_invoice_no_counter_master"
