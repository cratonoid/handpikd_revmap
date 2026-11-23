# Request/response bodies for the Inquiries module (routes/inquiries.py).
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.inquiry import InquiryStatus


class InquiryStepItem(BaseModel):
    status: InquiryStatus
    # What to show: the preset's name, or the custom label.
    label: str
    custom_label: str | None
    note: str | None
    created_at: datetime
    created_by_name: str | None


class InquiryItem(BaseModel):
    inquiry_id: int
    contact_id: int
    lead_name: str
    details: str
    assigned_user_id: int | None
    assigned_user_name: str | None
    # The latest step; None until the first one is added.
    current_status: InquiryStatus | None
    current_status_label: str | None
    # Oldest first.
    steps: list[InquiryStepItem]
    created_at: datetime
    updated_at: datetime


class AssignableUser(BaseModel):
    user_id: int
    name: str


class LeadOption(BaseModel):
    contact_id: int
    name: str


class StepFields(BaseModel):
    status: InquiryStatus
    custom_label: str | None = None
    note: str | None = None


class CreateInquiryRequest(BaseModel):
    contact_id: int
    details: str = Field(min_length=1)
    assigned_user_id: int | None = None
    # Optional first step, so an inquiry can start as "Requirements received".
    first_step: StepFields | None = None


class UpdateInquiryRequest(BaseModel):
    inquiry_id: int
    contact_id: int | None = None
    details: str | None = None
    # When sent, even as null, it's set (null unassigns); left out, unchanged.
    assigned_user_id: int | None = None


class AddInquiryStepRequest(StepFields):
    inquiry_id: int


class InquiryResponse(BaseModel):
    message: str
    inquiry: InquiryItem
