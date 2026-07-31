# Schema for the #vendor_poc_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated VendorPocDetails.id.
from beanie import Document


class VendorPocIdCounter(Document):
    id: int
    next_vendor_poc_id: int

    class Settings:
        name = "vendor_poc_id_counter"
