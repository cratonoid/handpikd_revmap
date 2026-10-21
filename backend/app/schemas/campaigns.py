# Request/response bodies for the Campaigns module's endpoints
# (routes/campaigns.py).
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.email_send import RecipientStatus
from app.schemas.emails import EmailSendItem


class CampaignItem(BaseModel):
    campaign_id: int
    name: str
    description: str | None
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


class CampaignDetail(BaseModel):
    campaign: CampaignItem
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


class CampaignResponse(BaseModel):
    message: str
    campaign: CampaignItem | None = None
