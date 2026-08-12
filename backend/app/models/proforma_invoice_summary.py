# Schema for the #proforma_invoice_summary collection.
from beanie import Document


class ProformaInvoiceSummary(Document):
    id: int
    invoice_id: int  # FK -> InvoiceDetails.id
    product_id: int  # FK -> ProductDetails.id
    quantity: int
    rate: float
    tax_perc: float
    tax_amount: float
    total: float

    class Settings:
        name = "proforma_invoice_summary"
