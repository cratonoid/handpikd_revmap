# Database module: endpoints for the admin's /admin/database address book
# (frontend components/admin/database-page-client.tsx) — three tabs of
# clients, leads and vendors, each a name, phone and optional email, with
# vendors also carrying a type, description and location, and leads a
# status (new / sent). Restricted to
# admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
#
# Same add / update-or-delete shape as routes/expenses.py.
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import ContactType, DatabaseContact, DatabaseContactIdCounter, LeadStatus, User
from app.schemas.database_contacts import (
    AddContactRequest,
    AddContactResponse,
    ContactItem,
    UpdateContactRequest,
    UpdateContactResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/database", tags=["database"])

_VENDOR_ONLY_FIELDS = ("vendor_type", "description", "location")


def _to_item(contact: DatabaseContact) -> ContactItem:
    return ContactItem(
        contact_id=contact.id,
        contact_type=contact.contact_type,
        name=contact.name,
        email=contact.email,
        phone=contact.phone,
        vendor_type=contact.vendor_type,
        description=contact.description,
        location=contact.location,
        lead_status=(contact.lead_status or LeadStatus.new) if contact.contact_type == ContactType.lead else None,
        created_at=contact.created_at,
    )


def _required(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")
    return cleaned


def _optional(value: str | None) -> str | None:
    # Blank and missing are the same thing here: "" is how the edit form
    # clears a field, and it's stored as None so the row reads as empty.
    if value is None:
        return None
    return value.strip() or None


def _clean_email(value: str | None) -> str | None:
    email = _optional(value)
    if email is not None and ("@" not in email or " " in email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="email address is not valid")
    return email


@router.get("/get_contacts", response_model=list[ContactItem])
async def get_contacts(
    contact_type: ContactType | None = None,
    _: User | None = Depends(require_admin),
) -> list[ContactItem]:
    # One tab at a time when `contact_type` is given, everything otherwise.
    # Newest first, the same rule lib/row-order.ts applies to every list.
    query = DatabaseContact.find_all() if contact_type is None else DatabaseContact.find(
        DatabaseContact.contact_type == contact_type
    )
    contacts = await query.sort(-DatabaseContact.id).to_list()
    return [_to_item(contact) for contact in contacts]


@router.post("/add_contact", response_model=AddContactResponse)
async def add_contact(
    payload: AddContactRequest,
    _: User | None = Depends(require_admin),
) -> AddContactResponse:
    is_vendor = payload.contact_type == ContactType.vendor
    contact = DatabaseContact(
        id=0,
        contact_type=payload.contact_type,
        name=_required(payload.name, "name"),
        phone=_required(payload.phone, "phone number"),
        email=_clean_email(payload.email),
        vendor_type=_optional(payload.vendor_type) if is_vendor else None,
        description=_optional(payload.description) if is_vendor else None,
        location=_optional(payload.location) if is_vendor else None,
        lead_status=(payload.lead_status or LeadStatus.new) if payload.contact_type == ContactType.lead else None,
    )
    # Id taken only once the payload has validated, so a rejected request
    # doesn't burn a number.
    contact.id = await get_next_id(DatabaseContactIdCounter, "next_database_contact_id", DatabaseContact)
    await contact.insert()

    return AddContactResponse(message="contact added successfully", contact=_to_item(contact))


@router.post("/update_contact", response_model=UpdateContactResponse)
async def update_contact(
    payload: UpdateContactRequest,
    _: User | None = Depends(require_admin),
) -> UpdateContactResponse:
    contact = await DatabaseContact.get(payload.contact_id)
    if contact is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="contact not found")

    if payload.delete:
        await contact.delete()
        return UpdateContactResponse(message="contact deleted successfully")

    changed = False
    if payload.name is not None:
        contact.name = _required(payload.name, "name")
        changed = True
    if payload.phone is not None:
        contact.phone = _required(payload.phone, "phone number")
        changed = True
    if payload.email is not None:
        contact.email = _clean_email(payload.email)
        changed = True
    if contact.contact_type == ContactType.vendor:
        for field in _VENDOR_ONLY_FIELDS:
            value = getattr(payload, field)
            if value is not None:
                setattr(contact, field, _optional(value))
                changed = True
    if contact.contact_type == ContactType.lead and payload.lead_status is not None:
        contact.lead_status = payload.lead_status
        changed = True

    if not changed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")

    await contact.save()
    return UpdateContactResponse(message="contact updated successfully", contact=_to_item(contact))
