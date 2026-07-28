# Schema for the #customer_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated CustomerDetails.id.
from beanie import Document


class CustomerIdCounter(Document):
    id: int
    next_customer_id: int

    class Settings:
        name = "customer_id_counter"
