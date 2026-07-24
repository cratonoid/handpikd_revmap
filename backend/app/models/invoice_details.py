# Schema for the #invoice_details collection.
from pydantic import BaseModel


class InvoiceDetails(BaseModel):
    id: int
    invoice_no: int
    sales_id: int  # FK -> SalesOrders.id
    amount: float
