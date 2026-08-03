# Request/response bodies for the vendors module's endpoints.
from pydantic import BaseModel, model_validator


class AddVendorDetailsRequest(BaseModel):
    registered_name: str
    gst: str
    address: str
    description: str
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "AddVendorDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class AddVendorDetailsResponse(BaseModel):
    message: str


class ConvertVendorQrResponse(BaseModel):
    # The decoded QR content, e.g. "upi://pay?pa=vendor@upibank&pn=Vendor&...".
    # This is what gets stored in VendorDetails.qr_code — see routes/vendors.py's
    # convert_vendor_qr.
    qr_code: str


class VendorDetailItem(BaseModel):
    id: int
    registered_name: str
    gst: str
    address: str
    description: str
    qr_code: str
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]


class UpdateVendorDetailsRequest(BaseModel):
    id: int
    registered_name: str
    gst: str
    address: str
    qr_code: str = ""
    description: str
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "UpdateVendorDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class UpdateVendorDetailsResponse(BaseModel):
    message: str
