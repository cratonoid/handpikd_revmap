# Schema for the #purchase_summary_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated PurchaseSummary.id.
from beanie import Document


class PurchaseSummaryIdCounter(Document):
    id: int
    next_purchase_summary_id: int

    class Settings:
        name = "purchase_summary_id_counter"
