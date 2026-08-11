# Schema for the #purchase_invoice_summary_id_counter collection.
from beanie import Document


class PurchaseInvoiceSummaryIdCounter(Document):
    id: int
    next_purchase_invoice_summary_id: int

    class Settings:
        name = "purchase_invoice_summary_id_counter"
