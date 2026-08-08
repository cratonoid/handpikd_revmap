# Schema for the #inquiry_form_submission collection: one row per visitor
# submission of the /hamper-inquiry-form page. `selections` snapshots the
# label/note/parent_id of every InquiryFormNode the visitor checked AT
# SUBMISSION TIME (rather than just storing node ids) so a submission still
# renders correctly in admin even after the hierarchy is later renamed,
# reparented, or a node is deleted.
from datetime import datetime

from beanie import Document
from pydantic import BaseModel


class SelectedInquiryFormNode(BaseModel):
    node_id: int
    parent_id: int | None
    label: str
    note: str | None = None


class InquiryFormSubmission(Document):
    id: int
    firm_name: str
    occasion: str
    item_quantity: int
    budget_per_item: float  # per-item budget, excluding GST
    selections: list[SelectedInquiryFormNode] = []
    created_at: datetime

    class Settings:
        name = "inquiry_form_submission"
