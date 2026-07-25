# Schema for the #vendor_poc_details collection.
from beanie import Document


class VendorPocDetails(Document):
    id: int
    vendor_id: int  # FK -> VendorDetails.id
    contact_name: str
    contact_phone: str

    class Settings:
        name = "vendor_poc_details"
