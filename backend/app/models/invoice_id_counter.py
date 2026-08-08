# Schema for the #invoice_id_counter collection.
from beanie import Document


class InvoiceIdCounter(Document):
    id: int
    next_invoice_id: int

    class Settings:
        name = "invoice_id_counter"
