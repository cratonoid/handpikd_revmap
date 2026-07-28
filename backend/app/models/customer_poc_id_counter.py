# Schema for the #customer_poc_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated CustomerPocDetails.id.
from beanie import Document


class CustomerPocIdCounter(Document):
    id: int
    next_customer_poc_id: int

    class Settings:
        name = "customer_poc_id_counter"
