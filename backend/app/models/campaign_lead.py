# Schema for the #campaign_leads collection: where a lead stands in one
# campaign. At most one row per (campaign, lead). Every Database lead is in
# every campaign; a lead with no row in a campaign is Unsent there with
# nothing set (see services/campaign_leads.py).
#
# The lead's own details — name, phone, email, contact person and the
# "Data present" channels — stay on its DatabaseContact row and are shared
# by every campaign it's in. What differs per campaign lives here: the
# Status (unsent / sent), the SD Status and the "Sent status" channels, so
# the same lead can be Sent in Diwali and still Unsent in the next one.
from datetime import datetime, timezone
from enum import Enum

from beanie import Document
from pydantic import Field
from pymongo import IndexModel

from app.models.database_contact import OutreachChannel, SdStatus


class CampaignLeadStatus(str, Enum):
    unsent = "unsent"
    sent = "sent"


class CampaignLead(Document):
    id: int
    campaign_id: int
    contact_id: int
    status: CampaignLeadStatus = CampaignLeadStatus.unsent
    # None until one is picked.
    sd_status: SdStatus | None = None
    # Ticked by hand, except that emailing the lead from this campaign ticks
    # "mail" itself (see services/email_sender.py).
    sent_channels: list[OutreachChannel] = []
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    class Settings:
        name = "campaign_leads"
        indexes = [
            IndexModel([("campaign_id", 1), ("contact_id", 1)], name="campaign_contact", unique=True),
            IndexModel("contact_id", name="contact_id"),
        ]
