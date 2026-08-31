# Schema for the #unbilled_purchase_summary_id_counter collection. Single
# document (_id=1) that tracks the next auto-generated
# UnbilledPurchaseSummary.id.
from beanie import Document


class UnbilledPurchaseSummaryIdCounter(Document):
    id: int
    next_unbilled_purchase_summary_id: int

    class Settings:
        name = "unbilled_purchase_summary_id_counter"
