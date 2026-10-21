# Schema for the #campaign_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated Campaign.id.
from beanie import Document


class CampaignIdCounter(Document):
    id: int
    next_campaign_id: int

    class Settings:
        name = "campaign_id_counter"
