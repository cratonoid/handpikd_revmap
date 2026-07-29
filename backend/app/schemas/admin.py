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
    def _check_contacts_match(self) -> "UpdateCustomerDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class UpdateCustomerDetailsResponse(BaseModel):
    message: str
