# Schema for the #purchase_invoice_no_counter_master collection.
from beanie import Document


class PurchaseInvoiceNoCounterMaster(Document):
    id: int
    next_purchase_invoice_no: int

    class Settings:
        name = "purchase_invoice_no_counter_master"
