# Schema for the #customer_details collection.
from pydantic import BaseModel


class CustomerDetails(BaseModel):
    id: int
    user_id: int  # FK -> User.id
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str
    points: int
