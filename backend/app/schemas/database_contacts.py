# Request/response bodies for the database module's endpoints (the admin's
# /admin/database address book of clients, leads and vendors).
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.database_contact import ContactType


class ContactItem(BaseModel):
    contact_id: int
    contact_type: ContactType
    name: str
    email: str | None
    phone: str
    vendor_type: str | None
    description: str | None
    location: str | None
    created_at: datetime


# Email and the three vendor fields are optional; the vendor fields are
# ignored on client and lead rows.
class AddContactRequest(BaseModel):
    contact_type: ContactType
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    email: str | None = None
    vendor_type: str | None = None
    description: str | None = None
    location: str | None = None


class AddContactResponse(BaseModel):
    message: str
    contact: ContactItem


# None leaves a field as it is; "" clears an optional one. `delete` on its
# own removes the row — see update_contact in routes/database_contacts.py.
class UpdateContactRequest(BaseModel):
    contact_id: int
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    vendor_type: str | None = None
    description: str | None = None
    location: str | None = None
    delete: bool = False


class UpdateContactResponse(BaseModel):
    message: str
    contact: ContactItem | None = None
