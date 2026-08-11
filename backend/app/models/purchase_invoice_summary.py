# Schema for the #purchase_invoice_summary collection.
from beanie import Document


class PurchaseInvoiceSummary(Document):
    id: int
    purchase_invoice_id: int  # FK -> PurchaseInvoiceDetails.id
    # Free text rather than a product_id FK: a vendor's PDF line items don't
    # reliably map to our own product catalogue. Only populated when the
    # owning PurchaseInvoiceDetails.source == pdf_upload.
    description: str
    hsn_code: str = ""
    quantity: float
    rate: float
    tax_perc: float
    tax_amount: float
    total: float

    class Settings:
        name = "purchase_invoice_summary"
