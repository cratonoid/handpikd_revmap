# Schema for the #proforma_invoice_no_counter_master collection.
from beanie import Document


class ProformaInvoiceNoCounterMaster(Document):
    id: int
    next_invoice_no: int

    class Settings:
        name = "proforma_invoice_no_counter_master"
