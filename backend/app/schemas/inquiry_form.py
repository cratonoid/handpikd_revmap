# Request/response bodies for the inquiry form module's endpoints (the
# admin-editable hierarchy + submissions behind the /hamper-inquiry-form
# visitor page).
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SelectionMode = Literal["single", "multi"]


class InquiryFormNodeItem(BaseModel):
    id: int
    parent_id: int | None
    label: str
    note: str | None
    prompt: str | None
    selection_mode: SelectionMode
    max_selections: int | None
    sort_order: int
    is_active: bool


class AddInquiryFormNodeRequest(BaseModel):
    parent_id: int | None = None
    label: str
    note: str | None = None
    prompt: str | None = None
    selection_mode: SelectionMode = "multi"
    max_selections: int | None = None
    sort_order: int = 0


class AddInquiryFormNodeResponse(BaseModel):
    message: str


# Full-replace update (mirrors update_catalogue_details/update_customer_details),
# except when `delete` is set, in which case every other field is ignored -
# same delete-flag shape as UpdateCategoryRequest in schemas/categories.py.
class UpdateInquiryFormNodeRequest(BaseModel):
    node_id: int
    delete: bool = False
    label: str = ""
    note: str | None = None
    prompt: str | None = None
    selection_mode: SelectionMode = "multi"
    max_selections: int | None = None
    sort_order: int = 0
    is_active: bool = True


class UpdateInquiryFormNodeResponse(BaseModel):
    message: str


class SelectedNodeItem(BaseModel):
    node_id: int
    parent_id: int | None
    label: str
    note: str | None


class SubmitInquiryFormRequest(BaseModel):
    firm_name: str
    occasion: str
    item_quantity: int
    budget_per_item: float  # per-item budget, excluding GST
    selected_node_ids: list[int] = []


class SubmitInquiryFormResponse(BaseModel):
    message: str


class InquiryFormSubmissionItem(BaseModel):
    id: int
    firm_name: str
    occasion: str
    item_quantity: int
    budget_per_item: float
    created_at: datetime
    selections: list[SelectedNodeItem]
