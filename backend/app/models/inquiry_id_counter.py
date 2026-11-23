# Schema for the #inquiry_id_counter collection. Single document holding the
# next Inquiry id (see services/counters.py).
from beanie import Document


class InquiryIdCounter(Document):
    id: int
    next_inquiry_id: int

    class Settings:
        name = "inquiry_id_counter"
