# Schema for the #database_contacts collection: the admin's /admin/database
# address book (frontend components/admin/database-page-client.tsx). One
# collection for all three tabs — clients, leads and vendors — told apart by
# `contact_type`, since they share every field bar the three vendor-only
# ones. Deliberately standalone: these rows are not linked to CustomerDetails
# or VendorDetails, which carry billing/GST data this list doesn't need.
from datetime import datetime, timezone
from enum import Enum

from beanie import Document
from pydantic import Field


class ContactType(str, Enum):
    client = "client"
    lead = "lead"
    vendor = "vendor"


class DatabaseContact(Document):
    id: int
    contact_type: ContactType
    name: str
    phone: str
    # Optional — plenty of leads only ever hand over a phone number.
    email: str | None = None
    # Vendor-only; always None on client and lead rows (see _apply_fields in
    # routes/database_contacts.py).
    vendor_type: str | None = None
    description: str | None = None
    location: str | None = None
    # Stamped server-side on insert.
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    class Settings:
        name = "database_contacts"
