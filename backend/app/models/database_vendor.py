# Schema for the #database_vendors collection — the simple vendor directory
# on the admin Database page's "Vendors" tab. Deliberately separate from
# VendorDetails (models/vendor_details.py), which is the richer vendor record
# used by the Vendors module (QR codes, GST, multiple points of contact) for
# invoicing/purchase orders. This one is a lightweight contact directory with
# no relationship to that module.
from beanie import Document


class DatabaseVendor(Document):
    id: int
    name: str
    phone: str
    address: str
    description: str

    class Settings:
        name = "database_vendors"