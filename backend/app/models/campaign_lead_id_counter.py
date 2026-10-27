# Schema for the #campaign_lead_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated CampaignLead.id.
from beanie import Document


class CampaignLeadIdCounter(Document):
    id: int
    next_campaign_lead_id: int

    class Settings:
        name = "campaign_lead_id_counter"
