# Schema for the #quotation_summary collection.
from beanie import Document


class QuotationSummary(Document):
    id: int
    quotation_id: int  # FK -> QuotationDetails.id
    product_id: int  # FK -> ProductDetails.id
    quantity: int
    rate: float
    tax_perc: float
    tax_amount: float
    total: float

    class Settings:
        name = "quotation_summary"
