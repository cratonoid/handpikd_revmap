# Campaigns module: the admin's /admin/campaigns page (frontend
# components/admin/campaigns-page-client.tsx) and each campaign's own page
# (campaign-detail-page-client.tsx).
#
# A campaign is a named mail-out over the whole /admin/database address
# book — leads, clients and vendors, read live — so it never holds a copy of
# the contacts. Mail goes out through the Emails module's /send with the
# campaign's id attached (routes/emails.py); everything this module reports
# about who has been sent what is worked out from those EmailSend rows.
from collections.abc import Iterable
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import require_section
from app.api.routes.emails import _to_send_item
from app.models import Campaign, CampaignIdCounter, EmailSend, RecipientStatus, Section, User
from app.schemas.campaigns import (
    AddCampaignRequest,
    CampaignContactStatus,
    CampaignDetail,
    CampaignItem,
    CampaignResponse,
    UpdateCampaignRequest,
)
from app.schemas.emails import EmailSendItem
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


def _to_item(campaign: Campaign, sends: list[EmailSendItem]) -> CampaignItem:
    statuses = contact_statuses(sends).values()
    sent_times = [send.created_at for send in sends]
    return CampaignItem(
        campaign_id=campaign.id,
        name=campaign.name,
        description=campaign.description,
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


async def _get_campaign_or_404(campaign_id: int) -> Campaign:
    campaign = await Campaign.get(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="campaign not found")
    return campaign


@router.get("/get_campaigns", response_model=list[CampaignItem])
async def get_campaigns(_: User | None = Depends(_require_campaigns)) -> list[CampaignItem]:
    campaigns = await Campaign.find_all().sort(-Campaign.id).to_list()
    sends = await _sends_for([campaign.id for campaign in campaigns])
    return [_to_item(campaign, sends[campaign.id]) for campaign in campaigns]


@router.get("/get_campaign", response_model=CampaignDetail)
async def get_campaign(campaign_id: int, _: User | None = Depends(_require_campaigns)) -> CampaignDetail:
    campaign = await _get_campaign_or_404(campaign_id)
    sends = (await _sends_for([campaign.id]))[campaign.id]
    return CampaignDetail(
        campaign=_to_item(campaign, sends),
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
    return CampaignResponse(message="campaign added successfully", campaign=_to_item(campaign, []))


@router.post("/update_campaign", response_model=CampaignResponse)
async def update_campaign(
    payload: UpdateCampaignRequest,
    _: User | None = Depends(_require_campaigns),
) -> CampaignResponse:
    campaign = await _get_campaign_or_404(payload.campaign_id)

    if payload.delete:
        # The campaign's EmailSend rows are kept: they're the record of mail
        # that really went out, and still list on the Emails page's Sent tab.
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
    return CampaignResponse(message="campaign updated successfully", campaign=_to_item(campaign, sends))
