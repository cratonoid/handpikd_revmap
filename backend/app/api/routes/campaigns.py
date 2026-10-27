# Campaigns module: the admin's /admin/campaigns page (frontend
# components/admin/campaigns-page-client.tsx) and each campaign's own page
# (campaign-detail-page-client.tsx).
#
# A campaign is a named outreach to a list of leads from the /admin/database
# address book. Which leads are in it, and each one's Status (unsent / sent),
# SD Status and "Sent status" channels in this campaign, are CampaignLead
# rows (models/campaign_lead.py); the lead's own details stay on its
# Database row and are shared with every other campaign it's in. Mail goes
# out through the Emails module's /send with the campaign's id attached
# (routes/emails.py); the delivery results shown per lead are worked out
# from those EmailSend rows.
from collections.abc import Iterable
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.api.routes.database_contacts import _ordered_channels
from app.api.routes.emails import _to_send_item
from app.models import (
    Campaign,
    CampaignIdCounter,
    CampaignLead,
    CampaignLeadStatus,
    EmailSend,
    RecipientStatus,
    SdStatus,
    Section,
    User,
)
from app.schemas.campaigns import (
    AddCampaignLeadsRequest,
    AddCampaignLeadsResponse,
    AddCampaignRequest,
    CampaignContactStatus,
    CampaignDetail,
    CampaignItem,
    CampaignLeadItem,
    CampaignResponse,
    UpdateCampaignLeadRequest,
    UpdateCampaignLeadResponse,
    UpdateCampaignRequest,
)
from app.schemas.emails import EmailSendItem
from app.services import campaign_leads
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/campaign", tags=["campaigns"])

_require_campaigns = require_section(Section.campaigns)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _required(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} is required")
    return cleaned


def _optional(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def contact_statuses(sends: Iterable[EmailSendItem]) -> dict[int, CampaignContactStatus]:
    """Each contact's standing in a campaign, from that campaign's sends.

    The latest attempt wins, except that a delivered email is never hidden
    by a later retry that failed or is still going out: the contact did get
    the campaign's mail. Statuses come from _to_send_item, so a send cut
    off by a restart already reads as failed rather than pending forever.
    """
    result: dict[int, CampaignContactStatus] = {}
    for send in sorted(sends, key=lambda item: item.send_id):
        for recipient in send.recipients:
            current = result.get(recipient.contact_id)
            attempts = (current.attempts if current else 0) + 1
            if current is not None and current.status == RecipientStatus.sent and recipient.status != RecipientStatus.sent:
                current.attempts = attempts
                continue
            result[recipient.contact_id] = CampaignContactStatus(
                contact_id=recipient.contact_id,
                status=recipient.status,
                sent_at=recipient.sent_at,
                error=recipient.error,
                template_name=send.template_name,
                attempts=attempts,
            )
    return result


def _to_lead_item(row: CampaignLead) -> CampaignLeadItem:
    return CampaignLeadItem(
        contact_id=row.contact_id,
        status=row.status,
        sd_status=row.sd_status,
        sent_channels=_ordered_channels(row.sent_channels),
        added_at=row.added_at,
    )


def _to_item(campaign: Campaign, sends: list[EmailSendItem], leads: list[CampaignLead]) -> CampaignItem:
    statuses = contact_statuses(sends).values()
    sent_times = [send.created_at for send in sends]
    return CampaignItem(
        campaign_id=campaign.id,
        name=campaign.name,
        description=campaign.description,
        lead_count=len(leads),
        sent_lead_count=sum(1 for row in leads if row.status == CampaignLeadStatus.sent),
        sent_count=sum(1 for entry in statuses if entry.status == RecipientStatus.sent),
        failed_count=sum(1 for entry in statuses if entry.status == RecipientStatus.failed),
        bounced_count=sum(1 for entry in statuses if entry.status == RecipientStatus.bounced),
        send_count=len(sends),
        last_sent_at=max(sent_times) if sent_times else None,
        created_at=campaign.created_at,
        updated_at=campaign.updated_at,
    )


async def _sends_for(campaign_ids: list[int]) -> dict[int, list[EmailSendItem]]:
    by_campaign: dict[int, list[EmailSendItem]] = {campaign_id: [] for campaign_id in campaign_ids}
    if not campaign_ids:
        return by_campaign
    sends = await EmailSend.find({"campaign_id": {"$in": campaign_ids}}).sort(-EmailSend.id).to_list()
    for send in sends:
        by_campaign[send.campaign_id].append(_to_send_item(send))
    return by_campaign


async def _leads_for(campaign_ids: list[int]) -> dict[int, list[CampaignLead]]:
    by_campaign: dict[int, list[CampaignLead]] = {campaign_id: [] for campaign_id in campaign_ids}
    if not campaign_ids:
        return by_campaign
    for row in await CampaignLead.find({"campaign_id": {"$in": campaign_ids}}).sort(-CampaignLead.id).to_list():
        by_campaign[row.campaign_id].append(row)
    return by_campaign


async def _get_campaign_or_404(campaign_id: int) -> Campaign:
    campaign = await Campaign.get(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="campaign not found")
    return campaign


@router.get("/get_campaigns", response_model=list[CampaignItem])
async def get_campaigns(_: User | None = Depends(_require_campaigns)) -> list[CampaignItem]:
    campaigns = await Campaign.find_all().sort(-Campaign.id).to_list()
    campaign_ids = [campaign.id for campaign in campaigns]
    sends = await _sends_for(campaign_ids)
    leads = await _leads_for(campaign_ids)
    return [_to_item(campaign, sends[campaign.id], leads[campaign.id]) for campaign in campaigns]


@router.get("/get_campaign", response_model=CampaignDetail)
async def get_campaign(campaign_id: int, _: User | None = Depends(_require_campaigns)) -> CampaignDetail:
    campaign = await _get_campaign_or_404(campaign_id)
    sends = (await _sends_for([campaign.id]))[campaign.id]
    leads = (await _leads_for([campaign.id]))[campaign.id]
    return CampaignDetail(
        campaign=_to_item(campaign, sends, leads),
        # Newest-added first, like every other list.
        leads=[_to_lead_item(row) for row in leads],
        contacts=list(contact_statuses(sends).values()),
        sends=sends,
    )


@router.post("/add_campaign", response_model=CampaignResponse)
async def add_campaign(payload: AddCampaignRequest, _: User | None = Depends(_require_campaigns)) -> CampaignResponse:
    campaign = Campaign(
        id=0,
        name=_required(payload.name, "campaign name"),
        description=_optional(payload.description),
    )
    campaign.id = await get_next_id(CampaignIdCounter, "next_campaign_id", Campaign)
    await campaign.insert()
    return CampaignResponse(message="campaign added successfully", campaign=_to_item(campaign, [], []))


@router.post("/update_campaign", response_model=CampaignResponse)
async def update_campaign(
    payload: UpdateCampaignRequest,
    _: User | None = Depends(_require_campaigns),
) -> CampaignResponse:
    campaign = await _get_campaign_or_404(payload.campaign_id)

    if payload.delete:
        # The campaign's EmailSend rows are kept: they're the record of mail
        # that really went out, and still list on the Emails page's Sent tab.
        # Its lead list goes; the leads themselves stay in the Database.
        await CampaignLead.find({"campaign_id": campaign.id}).delete()
        await campaign.delete()
        return CampaignResponse(message="campaign deleted successfully")

    if payload.name is None and payload.description is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")
    if payload.name is not None:
        campaign.name = _required(payload.name, "campaign name")
    if payload.description is not None:
        campaign.description = _optional(payload.description)
    campaign.updated_at = _now()
    await campaign.save()

    sends = (await _sends_for([campaign.id]))[campaign.id]
    leads = (await _leads_for([campaign.id]))[campaign.id]
    return CampaignResponse(message="campaign updated successfully", campaign=_to_item(campaign, sends, leads))


# Existing Database leads into the campaign, as Unsent. New leads made from
# the campaign's page go through /admin/database/add_contact with the
# campaign's id instead, which adds them here too.
@router.post("/add_leads", response_model=AddCampaignLeadsResponse)
async def add_leads(
    payload: AddCampaignLeadsRequest,
    _: User | None = Depends(_require_campaigns),
) -> AddCampaignLeadsResponse:
    campaign = await _get_campaign_or_404(payload.campaign_id)
    created = await campaign_leads.add_leads(campaign.id, payload.contact_ids)
    return AddCampaignLeadsResponse(
        message=f"{len(created)} lead(s) added", leads=[_to_lead_item(row) for row in created]
    )


@router.post("/update_lead", response_model=UpdateCampaignLeadResponse)
async def update_lead(
    payload: UpdateCampaignLeadRequest,
    _: User | None = Depends(_require_campaigns),
) -> UpdateCampaignLeadResponse:
    row = await CampaignLead.find_one({"campaign_id": payload.campaign_id, "contact_id": payload.contact_id})
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="this lead isn't in the campaign")

    if payload.remove:
        await row.delete()
        return UpdateCampaignLeadResponse(message="lead removed from the campaign")

    if payload.status is None and payload.sd_status is None and payload.sent_channels is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")
    if payload.status is not None:
        row.status = payload.status
    if payload.sd_status is not None:
        row.sd_status = SdStatus(payload.sd_status) if payload.sd_status else None
    if payload.sent_channels is not None:
        row.sent_channels = _ordered_channels(payload.sent_channels)
    await row.save()
    return UpdateCampaignLeadResponse(message="lead updated", lead=_to_lead_item(row))
