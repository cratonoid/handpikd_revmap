# Schema for the #customer_poc_details collection.
from beanie import Document


class CustomerPocDetails(Document):
    id: int
    customer_id: int  # FK -> CustomerDetails.id
    contact_name: str
    contact_phone: str

    class Settings:
        name = "customer_poc_details"
