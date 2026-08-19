# Schema for the #inquiry_form_submission collection: one row per visitor
# submission of the /hamper-inquiry-form page. `selections` snapshots the
# label/min_amount/parent_id of every InquiryFormNode the visitor checked AT
# SUBMISSION TIME (rather than just storing node ids) so a submission still
# renders correctly in admin even after the hierarchy is later renamed,
# repriced, reparented, or a node is deleted. `total_min_amount` likewise
# freezes the summed-up minimum the visitor was shown on the review step.
from datetime import datetime

from beanie import Document
from pydantic import BaseModel


class SelectedInquiryFormNode(BaseModel):
    node_id: int
    parent_id: int | None
    label: str
    min_amount: float | None = None


class InquiryFormSubmission(Document):
    id: int
    firm_name: str
    occasion: str
    item_quantity: int
    budget_per_item: float  # per-item budget, excluding GST
    selections: list[SelectedInquiryFormNode] = []
    total_min_amount: float = 0.0  # sum of every selection's min_amount, as shown to the visitor before submitting
    created_at: datetime

    class Settings:
        name = "inquiry_form_submission"
