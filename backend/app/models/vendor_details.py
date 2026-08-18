# Schema for the #vendor_details collection.
from enum import Enum

from beanie import Document


class VendorType(str, Enum):
    material = "material"
    printing = "printing"


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
    # None only for vendors created before vendor_type existed — the add/edit
    # form requires one of VendorType's values. Such legacy vendors show up
    # under the vendors page's "All" filter but neither type-specific filter.
    vendor_type: VendorType | None = None
    is_deleted: bool = False

    class Settings:
        name = "vendor_details"
