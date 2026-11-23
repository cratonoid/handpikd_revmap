# Schema for the #inquiry collection: the Inquiries module
# (routes/inquiries.py). An inquiry is raised against a Database lead,
# describes what the lead is asking for, and can be assigned to a team
# member. Its progress is a timeline of steps added one after another; the
# latest step is the inquiry's current status. Steps live on the inquiry
# itself rather than in their own collection: they're only ever read with it.
from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import BaseModel
from pymongo import IndexModel


class InquiryStatus(str, Enum):
    requirements_received = "requirements_received"
    options_shared = "options_shared"
    samples_delivered = "samples_delivered"
    advance_paid = "advance_paid"
    # Free text, held in InquiryStep.custom_label.
    custom = "custom"


class InquiryStep(BaseModel):
    status: InquiryStatus
    custom_label: str | None = None  # Set only when status is custom.
    note: str | None = None
    created_at: datetime
    created_by_user_id: int | None = None  # FK -> User.id; None with auth disabled


class Inquiry(Document):
    id: int
    contact_id: int  # FK -> DatabaseContact.id (a lead)
    details: str
    assigned_user_id: int | None = None  # FK -> User.id (a team account)
    steps: list[InquiryStep] = []
    created_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "inquiry"
        indexes = [
            IndexModel("contact_id", name="contact_id"),
            IndexModel("assigned_user_id", name="assigned_user_id"),
        ]
