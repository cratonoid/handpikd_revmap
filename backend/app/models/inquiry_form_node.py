# Schema for the #inquiry_form_node collection: the admin-editable, unlimited
# -depth hierarchy behind the /hamper-inquiry-form visitor page (Category ->
# Item -> Brand option -> ...), same self-referencing tree shape as Category
# (see models/category.py). `selection_mode`/`max_selections` describe how a
# visitor picks among THIS node's own children (not how this node itself is
# picked - that's governed by its parent's fields), so top-level nodes (the
# first multiselect step) are always implicitly multi/unlimited since they
# have no parent record to hold that config.
from typing import Literal

from beanie import Document


class InquiryFormNode(Document):
    id: int
    parent_id: int | None = None  # FK -> InquiryFormNode.id (self-referencing)
    label: str
    note: str | None = None  # short annotation shown next to the label, e.g. "400", "min 600"
    prompt: str | None = None  # heading shown above this node's children when a visitor is asked to pick among them
    selection_mode: Literal["single", "multi"] = "multi"
    max_selections: int | None = None  # cap on picks among this node's children when selection_mode == "multi"
    sort_order: int = 0
    is_active: bool = True  # inactive nodes are hidden from the public form but stay editable in admin

    class Settings:
        name = "inquiry_form_node"
