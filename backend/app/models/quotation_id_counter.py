# Schema for the #quotation_id_counter collection.
from beanie import Document


class QuotationIdCounter(Document):
    id: int
    next_quotation_id: int

    class Settings:
        name = "quotation_id_counter"
