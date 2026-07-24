# Schema for the #customer_poc_details collection.
from pydantic import BaseModel


class CustomerPocDetails(BaseModel):
    id: int
    customer_id: int  # FK -> CustomerDetails.id
    contact_name: str
    contact_phone: str
