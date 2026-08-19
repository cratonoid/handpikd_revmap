# Schema for the #inquiry_form_node collection: the admin-editable, unlimited
# -depth hierarchy behind the /hamper-inquiry-form visitor page (Category ->
# Item -> Brand option -> ...), same self-referencing tree shape as Category
# (see models/category.py). `selection_mode`/`max_selections` describe how a
# visitor picks among THIS node's own children (not how this node itself is
# picked - that's governed by its parent's fields), so top-level nodes (the
# first multiselect step) are always implicitly multi/unlimited since they
# have no parent record to hold that config. `min_amount` is instead about
# THIS node itself: the minimum spend (in rupees) an option costs, which the
# public form adds up across everything a visitor has checked and shows as a
# running total before they submit.
from typing import Literal

from beanie import Document


class InquiryFormNode(Document):
    id: int
    parent_id: int | None = None  # FK -> InquiryFormNode.id (self-referencing)
    label: str
    min_amount: float | None = None  # this option's own minimum spend in rupees; summed across a visitor's picks on the public form
    prompt: str | None = None  # heading shown above this node's children when a visitor is asked to pick among them
    selection_mode: Literal["single", "multi"] = "multi"
    max_selections: int | None = None  # cap on picks among this node's children when selection_mode == "multi"
    sort_order: int = 0
    is_active: bool = True  # inactive nodes are hidden from the public form but stay editable in admin

    class Settings:
        name = "inquiry_form_node"
