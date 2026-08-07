# Schema for the #invoice_no_counter_master collection.
from beanie import Document


class InvoiceNoCounterMaster(Document):
    id: int
    next_invoice_no: int

    class Settings:
        name = "invoice_no_counter_master"
