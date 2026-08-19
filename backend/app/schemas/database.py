# Request/response bodies for the admin Database page's endpoints (routes/database.py) —
# the simple Vendors/Leads directory, distinct from the richer schemas/vendors.py module.
from pydantic import BaseModel


class AddDatabaseVendorRequest(BaseModel):
    name: str
    phone: str
    address: str
    description: str


class AddDatabaseVendorResponse(BaseModel):
    message: str


class DatabaseVendorItem(BaseModel):
    id: int
    name: str
    phone: str
    address: str
    description: str


class UpdateDatabaseVendorRequest(BaseModel):
    id: int
    name: str
    phone: str
    address: str
    description: str


class UpdateDatabaseVendorResponse(BaseModel):
    message: str


class DeleteDatabaseVendorRequest(BaseModel):
    id: int


class DeleteDatabaseVendorResponse(BaseModel):
    message: str


class AddLeadRequest(BaseModel):
    name: str
    phone: str
    institute_name: str


class AddLeadResponse(BaseModel):
    message: str


class LeadItem(BaseModel):
    id: int
    name: str
    phone: str
    institute_name: str


class UpdateLeadRequest(BaseModel):
    id: int
    name: str
    phone: str
    institute_name: str


class UpdateLeadResponse(BaseModel):
    message: str


class DeleteLeadRequest(BaseModel):
    id: int


class DeleteLeadResponse(BaseModel):
    message: str
