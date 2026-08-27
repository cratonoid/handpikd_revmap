# Schema for the #printing_purchase_invoice_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated
# PrintingPurchaseInvoiceDetails.id.
from beanie import Document


class PrintingPurchaseInvoiceIdCounter(Document):
    id: int
    next_printing_purchase_invoice_id: int

    class Settings:
        name = "printing_purchase_invoice_id_counter"
