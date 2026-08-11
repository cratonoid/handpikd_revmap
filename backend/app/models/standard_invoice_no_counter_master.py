# Schema for the #standard_invoice_no_counter_master collection.
from beanie import Document


class StandardInvoiceNoCounterMaster(Document):
    id: int
    next_invoice_no: int

    class Settings:
        name = "standard_invoice_no_counter_master"
