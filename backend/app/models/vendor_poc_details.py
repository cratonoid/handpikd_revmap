# Schema for the #vendor_poc_details collection.
from pydantic import BaseModel


class VendorPocDetails(BaseModel):
    id: int
    vendor_id: int  # FK -> VendorDetails.id
    contact_name: str
    contact_phone: str
