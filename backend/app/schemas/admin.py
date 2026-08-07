# Request/response bodies for the admin module's customer details endpoints.
from pydantic import BaseModel, model_validator


class AddCustomerDetailsRequest(BaseModel):
    mail: str
    password: str
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str
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
    company_gst: str
    points: int
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]


class UpdateCustomerDetailsRequest(BaseModel):
    mail: str
    # Empty string means "leave the current password unchanged" — see
    # update_customer_details in routes/admin.py.
    password: str = ""
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str
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
    is_deleted: bool
