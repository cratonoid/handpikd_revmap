# Schema for the #vendor_details collection.
from beanie import Document


class VendorDetails(Document):
    id: int
    registered_name: str
    # Optional — a vendor can be added before their GST number is on hand.
    # Only vendors with a non-empty gst are offered in the product form's
    # vendor picker (see routes/vendors.py's get_vendors_list), since a
    # product's vendor needs to be GST-invoiceable.
    gst: str = ""
    address: str
    # Populated later by the separate add_qr_code endpoint, not at creation.
    qr_code: str = ""
    description: str
    is_deleted: bool = False

    class Settings:
        name = "vendor_details"
