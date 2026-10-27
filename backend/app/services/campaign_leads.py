# A lead's standing in each campaign (models/campaign_lead.py), shared by
# routes/campaigns.py, routes/database_contacts.py and the email sender.
#
# Every Database lead is in every campaign. A CampaignLead row only exists
# once something has been set for that lead in that campaign; until then
# the lead reads as Unsent with nothing ticked, so a new lead shows up in
# every campaign, and a new campaign holds every lead, with no rows written.
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


async def get_or_create(campaign_id: int, contact_id: int) -> CampaignLead:
    """The lead's row in the campaign, written as Unsent if it has none yet."""
    row = await CampaignLead.find_one({"campaign_id": campaign_id, "contact_id": contact_id})
    if row is not None:
        return row
    row = CampaignLead(id=0, campaign_id=campaign_id, contact_id=contact_id)
    row.id = await get_next_id(CampaignLeadIdCounter, "next_campaign_lead_id", CampaignLead)
    try:
        await row.insert()
    except DuplicateKeyError:
        # Written by a second request in the meantime; use that one.
        existing = await CampaignLead.find_one({"campaign_id": campaign_id, "contact_id": contact_id})
        if existing is None:
            raise
        return existing
    return row


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
    contact = await DatabaseContact.get(contact_id)
    if contact is None or contact.contact_type != ContactType.lead:
        return
    row = await get_or_create(campaign_id, contact_id)
    channels = list(row.sent_channels or [])
    if OutreachChannel.mail not in channels:
        channels.append(OutreachChannel.mail)
    row.sent_channels = channels
    row.status = CampaignLeadStatus.sent
    await row.save()
