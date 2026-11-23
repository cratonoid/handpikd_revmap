# Schema for the #campaigns collection: the admin's /admin/campaigns page
# (routes/campaigns.py). A campaign is only a name and a note. Its audience
# is the whole /admin/database address book, read live, so a contact added
# to the database after the campaign was made shows up in it too. What the
# campaign has sent lives on the EmailSend rows that carry its id
# (models/email_send.py), never copied here.
from datetime import datetime, timezone

from beanie import Document
from pydantic import Field


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Campaign(Document):
    id: int
    name: str
    description: str | None = None
    # Optional, as campaigns created before these existed have neither. The
    # start date also orders campaigns for Warm / Cold (see
    # services/campaign_leads.py), falling back to created_at when unset.
    start_date: datetime | None = None
    end_date: datetime | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)

    class Settings:
        name = "campaigns"
