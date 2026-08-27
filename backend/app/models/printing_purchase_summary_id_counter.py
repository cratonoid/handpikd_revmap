# Schema for the #printing_purchase_summary_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated
# PrintingPurchaseSummary.id.
from beanie import Document


class PrintingPurchaseSummaryIdCounter(Document):
    id: int
    next_printing_purchase_summary_id: int

    class Settings:
        name = "printing_purchase_summary_id_counter"
