# Schema for the #vendor_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated VendorDetails.id.
from beanie import Document


class VendorIdCounter(Document):
    id: int
    next_vendor_id: int

    class Settings:
        name = "vendor_id_counter"
