# Request/response bodies for the vendors module's endpoints.
from pydantic import BaseModel, model_validator

from app.models.vendor_details import VendorType


class AddVendorDetailsRequest(BaseModel):
    registered_name: str
    gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from gst" — the route calls
    # resolve_state_code before storing. state_name is always re-derived
    # from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    address: str
    description: str
    vendor_type: VendorType
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
    # "QR code added" / "QR code updated" — derived from whether the vendor
    # named by the request's optional vendor_id already had a qr_code set.
    # Purely informational for the popup; the decode itself never writes to
    # the database (that happens later via add_vendor_details/
    # update_vendor_details).
    message: str


class VendorListItem(BaseModel):
    vendor_id: int
    vendor_name: str
    gst: str
    # Rides along for the same reason gst does: the purchase order form
    # needs it the moment a vendor is picked, to decide whether that order
    # is taxed as SGST+CGST or IGST against our own state.
    state_code: str = ""
    state_name: str = ""
    # Which side of purchasing this vendor belongs to. The material and
    # printing purchase order forms each offer only their own kind, since
    # the two record entirely different documents (a printing order buys a
    # service and moves no stock — see routes/printing_orders.py), and the
    # backend rejects a vendor of the wrong type either way. None for
    # vendors predating the field, which neither form offers.
    vendor_type: VendorType | None = None


class VendorDetailItem(BaseModel):
    id: int
    registered_name: str
    gst: str
    state_code: str = ""
    state_name: str = ""
    address: str
    description: str
    qr_code: str
    # None for vendors created before vendor_type existed — see
    # models/vendor_details.py.
    vendor_type: VendorType | None = None
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]


class UpdateVendorDetailsRequest(BaseModel):
    id: int
    registered_name: str
    gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from gst" — the route calls
    # resolve_state_code before storing. state_name is always re-derived
    # from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    address: str
    qr_code: str = ""
    description: str
    vendor_type: VendorType
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
