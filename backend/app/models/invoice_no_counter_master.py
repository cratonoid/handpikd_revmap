# Schema for the #invoice_no_counter_master collection.
from pydantic import BaseModel


class InvoiceNoCounterMaster(BaseModel):
    id: int
    next_invoice_no: int
