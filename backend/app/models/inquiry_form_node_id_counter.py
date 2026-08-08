# Schema for the #inquiry_form_node_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated InquiryFormNode.id.
from beanie import Document


class InquiryFormNodeIdCounter(Document):
    id: int
    next_inquiry_form_node_id: int

    class Settings:
        name = "inquiry_form_node_id_counter"
