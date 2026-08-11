# Schema for the #purchase_invoice_id_counter collection.
from beanie import Document


class PurchaseInvoiceIdCounter(Document):
    id: int
    next_purchase_invoice_id: int

    class Settings:
        name = "purchase_invoice_id_counter"
