# Schema for the #quotation_no_counter_master collection.
from beanie import Document


class QuotationNoCounterMaster(Document):
    id: int
    next_quotation_no: int

    class Settings:
        name = "quotation_no_counter_master"
