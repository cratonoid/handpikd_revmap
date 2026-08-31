# Request/response bodies for the admin module's customer details endpoints.
from pydantic import BaseModel, model_validator


class AddCustomerDetailsRequest(BaseModel):
    mail: str
    password: str
    registered_name: str
    company_or_department: str
    address: str
    # Optional — not every client is GST-registered. Blank is a supported
    # value all the way down: is_intra_state in services/gst.py reads a
    # missing buyer GSTIN as inter-state (IGST), and the invoice PDF renders
    # an empty Place of Supply rather than failing.
    company_gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from company_gst" — the route calls
    # resolve_state_code before storing, so a client whose GSTIN is on file
    # never has to have their state keyed in separately. state_name is
    # always re-derived from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    points: int
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "AddCustomerDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class AddCustomerDetailsResponse(BaseModel):
    message: str


class CustomerDetailItem(BaseModel):
    mail: str
    password: str
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str = ""
    state_code: str = ""
    state_name: str = ""
    points: int
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]


class UpdateCustomerDetailsRequest(BaseModel):
    # The customer being edited, identified by their CURRENT email — it is
    # the only handle the frontend has (CustomerDetailItem exposes no id).
    mail: str
    # The address to rename that login to. Empty (or identical to `mail`)
    # means "leave the email alone"; anything else is only accepted if no
    # other user already holds it — see update_customer_details in
    # routes/admin.py.
    new_mail: str = ""
    # Empty string means "leave the current password unchanged" — see
    # update_customer_details in routes/admin.py.
    password: str = ""
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from company_gst" — the route calls
    # resolve_state_code before storing, so a client whose GSTIN is on file
    # never has to have their state keyed in separately. state_name is
    # always re-derived from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    points: int
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "UpdateCustomerDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class UpdateCustomerDetailsResponse(BaseModel):
    message: str


class CustomerListItem(BaseModel):
    # Lightweight id+name shape for customer-picker dropdowns (the sales
    # order popup) — unlike get_vendors_list/VendorListItem, this returns
    # EVERY customer (active and deleted), since CustomerDetailItem above has
    # no numeric id at all and this is the only place the frontend can
    # resolve a sales order's cust_id back to a name.
    customer_id: int
    customer_name: str
    # Carried alongside the name because one registered name can cover
    # several departments, which the name alone doesn't distinguish in the
    # sales order form's customer picker. Defaulted since it's free text and
    # may be blank on older clients.
    company_or_department: str = ""
    is_deleted: bool
