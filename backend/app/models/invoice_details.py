# Schema for the #invoice_details collection.
from beanie import Document


class InvoiceDetails(Document):
    id: int
    invoice_no: int
    sales_id: int  # FK -> SalesOrders.id
    amount: float

    class Settings:
        name = "invoice_details"
