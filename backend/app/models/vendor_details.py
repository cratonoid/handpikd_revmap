# Schema for the #vendor_details collection.
from pydantic import BaseModel


class VendorDetails(BaseModel):
    id: int
    registered_name: str
    gst: str
    address: str
    qr_code: str
    description: str
