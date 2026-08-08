# Schema for the #quotation_summary_id_counter collection.
from beanie import Document


class QuotationSummaryIdCounter(Document):
    id: int
    next_quotation_summary_id: int

    class Settings:
        name = "quotation_summary_id_counter"
