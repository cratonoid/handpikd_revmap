# Schema for the #vendor_details collection.
from beanie import Document


class VendorDetails(Document):
    id: int
    registered_name: str
    gst: str
    address: str
    # Populated later by the separate add_qr_code endpoint, not at creation.
    qr_code: str = ""
    description: str
    is_deleted: bool = False

    class Settings:
        name = "vendor_details"
