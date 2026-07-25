# Schema for the #vendor_details collection.
from beanie import Document


class VendorDetails(Document):
    id: int
    registered_name: str
    gst: str
    address: str
    qr_code: str
    description: str

    class Settings:
        name = "vendor_details"
