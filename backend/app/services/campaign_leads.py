# Campaign membership: which leads are in which campaign (models/
# campaign_lead.py), shared by routes/campaigns.py, routes/database_contacts.py
# and the email sender.
from collections.abc import Iterable

from pymongo.errors import DuplicateKeyError

from app.models import (
    CampaignLead,
    CampaignLeadIdCounter,
    CampaignLeadStatus,
    ContactType,
    DatabaseContact,
    LeadStatus,
    OutreachChannel,
)
from app.services.counters import get_next_id


async def add_leads(campaign_id: int, contact_ids: Iterable[int]) -> list[CampaignLead]:
    """Adds leads to a campaign as Unsent; ones already in it are left as they are.

    Returns only the rows it created. Anything that isn't a lead is skipped.
    """
    wanted = list(dict.fromkeys(contact_ids))
    if not wanted:
        return []
    leads = await DatabaseContact.find(
        {"_id": {"$in": wanted}, "contact_type": ContactType.lead.value}
    ).to_list()
    lead_ids = {lead.id for lead in leads}
    existing = {
        row.contact_id
        for row in await CampaignLead.find({"campaign_id": campaign_id, "contact_id": {"$in": wanted}}).to_list()
    }

    created: list[CampaignLead] = []
    for contact_id in wanted:
        if contact_id not in lead_ids or contact_id in existing:
            continue
        row = CampaignLead(id=0, campaign_id=campaign_id, contact_id=contact_id)
        row.id = await get_next_id(CampaignLeadIdCounter, "next_campaign_lead_id", CampaignLead)
        try:
            await row.insert()
        except DuplicateKeyError:
            # Added by a second request in the meantime; it's in either way.
            continue
        created.append(row)
    return created


async def warm_contact_ids() -> set[int]:
    """Leads reached at least once: in any campaign, or before campaigns
    were tracked per lead (the Database row's old Status / Sent status)."""
    warm = {
        row["contact_id"]
        async for row in CampaignLead.get_pymongo_collection().find(
            {"$or": [{"status": CampaignLeadStatus.sent.value}, {"sent_channels.0": {"$exists": True}}]},
            {"contact_id": 1},
        )
    }
    warm |= {
        row["_id"]
        async for row in DatabaseContact.get_pymongo_collection().find(
            {
                "contact_type": ContactType.lead.value,
                "$or": [{"lead_status": LeadStatus.sent.value}, {"sent_channels.0": {"$exists": True}}],
            },
            {"_id": 1},
        )
    }
    return warm


async def mark_emailed(campaign_id: int, contact_id: int) -> None:
    """A lead emailed from a campaign is Sent there, with Mail ticked."""
    row = await CampaignLead.find_one({"campaign_id": campaign_id, "contact_id": contact_id})
    if row is None:
        return
    channels = list(row.sent_channels or [])
    if OutreachChannel.mail not in channels:
        channels.append(OutreachChannel.mail)
    row.sent_channels = channels
    row.status = CampaignLeadStatus.sent
    await row.save()
