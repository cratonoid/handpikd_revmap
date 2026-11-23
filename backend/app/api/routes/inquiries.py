# Inquiries module: what a Database lead is asking for, who on the team owns
# it, and a timeline of how far it has got (models/inquiry.py).
#
# Not to be confused with the storefront's inquiries (routes/inquiry_form.py
# and routes/product_inquiries.py), which are what visitors submit. These
# are raised by the team, against a lead, and worked through.
#
# Statuses are added one after another rather than overwritten, so the
# inquiry keeps its history: Requirements received -> Options shared -> ...
# Any status can follow any other (and a custom one can be typed), since
# real inquiries skip steps and go back. The latest step is the current one.
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.models import (
    ContactType,
    DatabaseContact,
    Inquiry,
    InquiryIdCounter,
    InquiryStatus,
    InquiryStep,
    Section,
    User,
    UserRole,
)
from app.schemas.inquiries import (
    AddInquiryStepRequest,
    AssignableUser,
    CreateInquiryRequest,
    InquiryItem,
    InquiryResponse,
    InquiryStepItem,
    LeadOption,
    StepFields,
    UpdateInquiryRequest,
)
from app.services.counters import get_next_id
from app.services.notifications import notify

router = APIRouter(prefix="/admin/inquiries", tags=["inquiries"])

_require_inquiries = require_section(Section.inquiries)

DETAILS_MAX_LENGTH = 5_000
NOTE_MAX_LENGTH = 2_000
CUSTOM_LABEL_MAX_LENGTH = 80

STATUS_LABELS: dict[InquiryStatus, str] = {
    InquiryStatus.requirements_received: "Requirements received",
    InquiryStatus.options_shared: "Options shared",
    InquiryStatus.samples_delivered: "Samples delivered",
    InquiryStatus.advance_paid: "Advance paid",
    InquiryStatus.custom: "Custom",
}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _user_name(user: User) -> str:
    return user.name.strip() or user.mail


def _step_label(step: InquiryStep) -> str:
    if step.status == InquiryStatus.custom and step.custom_label:
        return step.custom_label
    return STATUS_LABELS[step.status]


def _clean_details(value: str) -> str:
    details = value.strip()
    if not details:
        raise _bad_request("describe what the inquiry is about")
    if len(details) > DETAILS_MAX_LENGTH:
        raise _bad_request(f"details can be at most {DETAILS_MAX_LENGTH} characters")
    return details


def _build_step(fields: StepFields, user: User | None) -> InquiryStep:
    custom_label = (fields.custom_label or "").strip() or None
    if fields.status == InquiryStatus.custom:
        if not custom_label:
            raise _bad_request("enter a name for the custom status")
        if len(custom_label) > CUSTOM_LABEL_MAX_LENGTH:
            raise _bad_request(f"a custom status can be at most {CUSTOM_LABEL_MAX_LENGTH} characters")
    else:
        custom_label = None
    note = (fields.note or "").strip() or None
    if note and len(note) > NOTE_MAX_LENGTH:
        raise _bad_request(f"a note can be at most {NOTE_MAX_LENGTH} characters")
    return InquiryStep(
        status=fields.status,
        custom_label=custom_label,
        note=note,
        created_at=_now(),
        created_by_user_id=user.id if user else None,
    )


async def _get_lead_or_404(contact_id: int) -> DatabaseContact:
    contact = await DatabaseContact.get(contact_id)
    if contact is None or contact.contact_type != ContactType.lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lead not found")
    return contact


async def _get_assignee_or_400(user_id: int) -> User:
    user = await User.get(user_id)
    if user is None or user.role != UserRole.admin or not user.is_active:
        raise _bad_request("that user can't be assigned: pick an active team member")
    return user


async def _get_inquiry_or_404(inquiry_id: int) -> Inquiry:
    inquiry = await Inquiry.get(inquiry_id)
    if inquiry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="inquiry not found")
    return inquiry


async def _to_items(inquiries: list[Inquiry]) -> list[InquiryItem]:
    contact_ids = {inquiry.contact_id for inquiry in inquiries}
    user_ids = {inquiry.assigned_user_id for inquiry in inquiries if inquiry.assigned_user_id is not None}
    user_ids |= {
        step.created_by_user_id
        for inquiry in inquiries
        for step in inquiry.steps
        if step.created_by_user_id is not None
    }
    contacts = (
        {c.id: c for c in await DatabaseContact.find(In(DatabaseContact.id, list(contact_ids))).to_list()}
        if contact_ids
        else {}
    )
    users = {u.id: u for u in await User.find(In(User.id, list(user_ids))).to_list()} if user_ids else {}

    def name_of(user_id: int | None) -> str | None:
        user = users.get(user_id) if user_id is not None else None
        return _user_name(user) if user else None

    items = []
    for inquiry in inquiries:
        contact = contacts.get(inquiry.contact_id)
        latest = inquiry.steps[-1] if inquiry.steps else None
        items.append(
            InquiryItem(
                inquiry_id=inquiry.id,
                contact_id=inquiry.contact_id,
                lead_name=contact.name if contact else "Deleted lead",
                details=inquiry.details,
                assigned_user_id=inquiry.assigned_user_id,
                assigned_user_name=name_of(inquiry.assigned_user_id),
                current_status=latest.status if latest else None,
                current_status_label=_step_label(latest) if latest else None,
                steps=[
                    InquiryStepItem(
                        status=step.status,
                        label=_step_label(step),
                        custom_label=step.custom_label,
                        note=step.note,
                        created_at=step.created_at,
                        created_by_name=name_of(step.created_by_user_id),
                    )
                    for step in inquiry.steps
                ],
                created_at=inquiry.created_at,
                updated_at=inquiry.updated_at,
            )
        )
    return items


async def _notify_assignee(inquiry: Inquiry, lead_name: str, assigner: User | None) -> None:
    # Nobody needs telling they assigned something to themselves.
    if inquiry.assigned_user_id is None or (assigner and assigner.id == inquiry.assigned_user_id):
        return
    await notify(
        kind="inquiry.assigned",
        title=f"Inquiry assigned to you: {lead_name}",
        body=inquiry.details[:140],
        section=Section.inquiries,
        link=f"/admin/inquiries?inquiry={inquiry.id}",
        recipient_user_id=inquiry.assigned_user_id,
    )


@router.get("/get_inquiries", response_model=list[InquiryItem])
async def get_inquiries(_: User | None = Depends(_require_inquiries)) -> list[InquiryItem]:
    inquiries = await Inquiry.find_all().sort(-Inquiry.updated_at).to_list()
    return await _to_items(inquiries)


@router.get("/get_assignable_users", response_model=list[AssignableUser])
async def get_assignable_users(_: User | None = Depends(_require_inquiries)) -> list[AssignableUser]:
    users = await User.find(User.role == UserRole.admin, User.is_active == True).to_list()  # noqa: E712
    return sorted(
        (AssignableUser(user_id=user.id, name=_user_name(user)) for user in users),
        key=lambda user: user.name.lower(),
    )


@router.get("/get_leads", response_model=list[LeadOption])
async def get_leads(_: User | None = Depends(_require_inquiries)) -> list[LeadOption]:
    # Its own endpoint rather than the Database page's get_contacts, so a role
    # can be given Inquiries without being given the whole Database.
    leads = await DatabaseContact.find(DatabaseContact.contact_type == ContactType.lead).to_list()
    return sorted(
        (LeadOption(contact_id=lead.id, name=lead.name) for lead in leads), key=lambda lead: lead.name.lower()
    )


@router.post("/create_inquiry", response_model=InquiryResponse)
async def create_inquiry(
    payload: CreateInquiryRequest,
    current_user: User | None = Depends(_require_inquiries),
) -> InquiryResponse:
    lead = await _get_lead_or_404(payload.contact_id)
    details = _clean_details(payload.details)
    if payload.assigned_user_id is not None:
        await _get_assignee_or_400(payload.assigned_user_id)
    steps = [_build_step(payload.first_step, current_user)] if payload.first_step else []

    now = _now()
    inquiry = Inquiry(
        id=0,
        contact_id=lead.id,
        details=details,
        assigned_user_id=payload.assigned_user_id,
        steps=steps,
        created_by_user_id=current_user.id if current_user else None,
        created_at=now,
        updated_at=now,
    )
    # Id taken only once everything has validated, so a rejected request
    # doesn't burn a number.
    inquiry.id = await get_next_id(InquiryIdCounter, "next_inquiry_id", Inquiry)
    await inquiry.insert()
    await _notify_assignee(inquiry, lead.name, current_user)

    (item,) = await _to_items([inquiry])
    return InquiryResponse(message="inquiry created", inquiry=item)


@router.post("/update_inquiry", response_model=InquiryResponse)
async def update_inquiry(
    payload: UpdateInquiryRequest,
    current_user: User | None = Depends(_require_inquiries),
) -> InquiryResponse:
    inquiry = await _get_inquiry_or_404(payload.inquiry_id)
    assignee_sent = "assigned_user_id" in payload.model_fields_set
    if payload.contact_id is None and payload.details is None and not assignee_sent:
        raise _bad_request("no changes specified")

    if payload.contact_id is not None:
        inquiry.contact_id = (await _get_lead_or_404(payload.contact_id)).id
    if payload.details is not None:
        inquiry.details = _clean_details(payload.details)
    newly_assigned = False
    if assignee_sent and payload.assigned_user_id != inquiry.assigned_user_id:
        if payload.assigned_user_id is not None:
            await _get_assignee_or_400(payload.assigned_user_id)
        inquiry.assigned_user_id = payload.assigned_user_id
        newly_assigned = payload.assigned_user_id is not None
    inquiry.updated_at = _now()
    await inquiry.save()

    (item,) = await _to_items([inquiry])
    if newly_assigned:
        await _notify_assignee(inquiry, item.lead_name, current_user)
    return InquiryResponse(message="inquiry updated", inquiry=item)


@router.post("/add_step", response_model=InquiryResponse)
async def add_step(
    payload: AddInquiryStepRequest,
    current_user: User | None = Depends(_require_inquiries),
) -> InquiryResponse:
    inquiry = await _get_inquiry_or_404(payload.inquiry_id)
    inquiry.steps.append(_build_step(payload, current_user))
    inquiry.updated_at = _now()
    await inquiry.save()

    (item,) = await _to_items([inquiry])
    return InquiryResponse(message="status added", inquiry=item)
