# Request/response bodies for the Campaigns module's endpoints
# (routes/campaigns.py).
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.campaign_lead import CampaignLeadStatus
from app.models.database_contact import OutreachChannel, SdStatus
from app.models.email_send import RecipientStatus
from app.schemas.emails import EmailSendItem


class CampaignItem(BaseModel):
    campaign_id: int
    name: str
    description: str | None
    # Leads in the campaign, and how many of them are Sent.
    lead_count: int
    sent_lead_count: int
    # Distinct contacts with a delivered (not bounced) email from this
    # campaign, and those whose latest attempt failed or bounced.
    sent_count: int
    failed_count: int
    bounced_count: int
    send_count: int
    last_sent_at: datetime | None
    created_at: datetime
    updated_at: datetime


# Where one database contact stands in a campaign. Contacts the campaign
# hasn't emailed have no entry at all.
class CampaignContactStatus(BaseModel):
    contact_id: int
    status: RecipientStatus
    # When the delivered email went out; None until one has.
    sent_at: datetime | None
    error: str | None
    template_name: str | None
    # How many times this campaign has emailed the contact, retries included.
    attempts: int


# One lead's row in a campaign: the parts that are this campaign's own. The
# lead's details come from the Database (routes/database_contacts.py).
class CampaignLeadItem(BaseModel):
    contact_id: int
    status: CampaignLeadStatus
    sd_status: SdStatus | None
    sent_channels: list[OutreachChannel]
    added_at: datetime


class CampaignDetail(BaseModel):
    campaign: CampaignItem
    leads: list[CampaignLeadItem]
    contacts: list[CampaignContactStatus]
    # Newest first.
    sends: list[EmailSendItem]


class AddCampaignRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None


# None leaves a field as it is; "" clears the description. `delete` on its
# own removes the campaign; its sends stay in the Emails page's history.
class UpdateCampaignRequest(BaseModel):
    campaign_id: int
    name: str | None = None
    description: str | None = None
    delete: bool = False


class AddCampaignLeadsRequest(BaseModel):
    campaign_id: int
    contact_ids: list[int] = Field(min_length=1)


class AddCampaignLeadsResponse(BaseModel):
    message: str
    leads: list[CampaignLeadItem]


# None leaves a field as it is; "" clears the SD status. `remove` on its own
# takes the lead out of the campaign (it stays in the Database).
class UpdateCampaignLeadRequest(BaseModel):
    campaign_id: int
    contact_id: int
    status: CampaignLeadStatus | None = None
    sd_status: SdStatus | Literal[""] | None = None
    # The full set of ticked channels, not a delta; [] unticks both.
    sent_channels: list[OutreachChannel] | None = None
    remove: bool = False


class UpdateCampaignLeadResponse(BaseModel):
    message: str
    lead: CampaignLeadItem | None = None


class CampaignResponse(BaseModel):
    message: str
    campaign: CampaignItem | None = None
