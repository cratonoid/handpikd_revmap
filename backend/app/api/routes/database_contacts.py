# Database module: endpoints for the admin's /admin/database address book
# (frontend components/admin/database-page-client.tsx) — three tabs of
# clients, leads and vendors, each a name, phone and optional email, with
# vendors also carrying a type, description and location, and leads an
# optional contact person, a status (new / sent) and the outreach channels
# (WhatsApp / mail) they've been reached on. Restricted to
# admins (bypassed entirely when settings.auth_enabled is False, matching
# require_staff in api/deps.py).
#
# Same add / update-or-delete shape as routes/expenses.py.
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.models import Section, ContactType, DatabaseContact, DatabaseContactIdCounter, LeadStatus, OutreachChannel, User
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
        contact_person=contact.contact_person,
        lead_status=(contact.lead_status or LeadStatus.new) if contact.contact_type == ContactType.lead else None,
        outreach_channels=_ordered_channels(contact.outreach_channels) if contact.contact_type == ContactType.lead else [],
        created_at=contact.created_at,
    )


def _ordered_channels(channels: list[OutreachChannel] | None) -> list[OutreachChannel]:
    # Deduplicated and in the enum's order, however the request listed them,
    # so the stored list compares cleanly and always reads WhatsApp, mail.
    chosen = set(channels or [])
    return [channel for channel in OutreachChannel if channel in chosen]


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
    _: User | None = Depends(require_section(Section.database)),
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
    _: User | None = Depends(require_section(Section.database)),
) -> AddContactResponse:
    is_vendor = payload.contact_type == ContactType.vendor
    is_lead = payload.contact_type == ContactType.lead
    contact = DatabaseContact(
        id=0,
        contact_type=payload.contact_type,
        name=_required(payload.name, "name"),
        phone=_required(payload.phone, "phone number"),
        email=_clean_email(payload.email),
        vendor_type=_optional(payload.vendor_type) if is_vendor else None,
        description=_optional(payload.description) if is_vendor else None,
        location=_optional(payload.location) if is_vendor else None,
        contact_person=_optional(payload.contact_person) if is_lead else None,
        lead_status=(payload.lead_status or LeadStatus.new) if is_lead else None,
        outreach_channels=_ordered_channels(payload.outreach_channels) if is_lead else [],
    )
    # Id taken only once the payload has validated, so a rejected request
    # doesn't burn a number.
    contact.id = await get_next_id(DatabaseContactIdCounter, "next_database_contact_id", DatabaseContact)
    await contact.insert()

    return AddContactResponse(message="contact added successfully", contact=_to_item(contact))


@router.post("/update_contact", response_model=UpdateContactResponse)
async def update_contact(
    payload: UpdateContactRequest,
    _: User | None = Depends(require_section(Section.database)),
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
    if contact.contact_type == ContactType.lead:
        if payload.contact_person is not None:
            contact.contact_person = _optional(payload.contact_person)
            changed = True
        if payload.lead_status is not None:
            contact.lead_status = payload.lead_status
            changed = True
        if payload.outreach_channels is not None:
            contact.outreach_channels = _ordered_channels(payload.outreach_channels)
            changed = True

    if not changed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")

    await contact.save()
    return UpdateContactResponse(message="contact updated successfully", contact=_to_item(contact))
