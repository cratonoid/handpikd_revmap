# Schema for the #proforma_invoice_summary_id_counter collection.
from beanie import Document


class ProformaInvoiceSummaryIdCounter(Document):
    id: int
    next_proforma_invoice_summary_id: int

    class Settings:
        name = "proforma_invoice_summary_id_counter"
