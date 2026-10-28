# A lead's standing in each campaign (models/campaign_lead.py), shared by
# routes/campaigns.py, routes/database_contacts.py and the email sender.
#
# Every Database lead is in every campaign. A CampaignLead row only exists
# once something has been set for that lead in that campaign; until then
# the lead reads as Unsent with nothing ticked, so a new lead shows up in
# every campaign, and a new campaign holds every lead, with no rows written.
#
# A lead's Status follows its ticks: once every "Data present" channel is
# ticked in its Sent status it turns Sent, and unticking one (or adding a
# Data present channel) turns it back to Unsent. The admin can still set the
# Status by hand afterwards; the rule runs again on the next tick change.
# Warm / Cold doesn't look at Status at all, only at the ticks.
from pymongo.errors import DuplicateKeyError

from app.models import (
    CampaignLead,
    CampaignLeadIdCounter,
    CampaignLeadStatus,
    ContactType,
    DatabaseContact,
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


def fully_sent(data_present: list | None, sent_channels: list | None) -> bool:
    """Every Data present channel is ticked in Sent status. A lead with no
    Data present can't be fully sent."""
    present = set(data_present or [])
    return bool(present) and present <= set(sent_channels or [])


def apply_rule(row: CampaignLead, data_present: list | None) -> None:
    row.status = CampaignLeadStatus.sent if fully_sent(data_present, row.sent_channels) else CampaignLeadStatus.unsent


async def warm_contact_ids() -> set[int]:
    """Leads fully sent (every Data present channel ticked) in at least one
    campaign."""
    data_present = {
        row["_id"]: row.get("outreach_channels")
        async for row in DatabaseContact.get_pymongo_collection().find(
            {"contact_type": ContactType.lead.value, "outreach_channels.0": {"$exists": True}},
            {"outreach_channels": 1},
        )
    }
    return {
        row["contact_id"]
        async for row in CampaignLead.get_pymongo_collection().find(
            {"contact_id": {"$in": list(data_present)}, "sent_channels.0": {"$exists": True}},
            {"contact_id": 1, "sent_channels": 1},
        )
        if fully_sent(data_present[row["contact_id"]], row.get("sent_channels"))
    }


async def is_warm(contact: DatabaseContact) -> bool:
    if contact.contact_type != ContactType.lead or not contact.outreach_channels:
        return False
    rows = await CampaignLead.find({"contact_id": contact.id}).to_list()
    return any(fully_sent(contact.outreach_channels, row.sent_channels) for row in rows)


async def reapply_rule_for(contact: DatabaseContact) -> None:
    """The lead's Data present changed: re-run the rule in every campaign
    where it has something ticked. Rows with nothing ticked keep their
    Status, which can only have been set by hand."""
    for row in await CampaignLead.find({"contact_id": contact.id, "sent_channels.0": {"$exists": True}}).to_list():
        before = row.status
        apply_rule(row, contact.outreach_channels)
        if row.status != before:
            await row.save()


async def mark_emailed(campaign_id: int, contact_id: int) -> None:
    """A lead emailed from a campaign has Mail ticked there, which turns it
    Sent if that was the last Data present channel left."""
    contact = await DatabaseContact.get(contact_id)
    if contact is None or contact.contact_type != ContactType.lead:
        return
    row = await get_or_create(campaign_id, contact_id)
    channels = list(row.sent_channels or [])
    if OutreachChannel.mail in channels:
        return
    channels.append(OutreachChannel.mail)
    row.sent_channels = channels
    apply_rule(row, contact.outreach_channels)
    await row.save()
