# Schema for the #customer_details collection.
from beanie import Document


class CustomerDetails(Document):
    id: int
    user_id: int  # FK -> User.id
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str
    points: int
    is_deleted: bool = False

    class Settings:
        name = "customer_details"
