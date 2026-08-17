# Schema for the #product_inquiry_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated ProductInquiry.id.
from beanie import Document


class ProductInquiryIdCounter(Document):
    id: int
    next_product_inquiry_id: int

    class Settings:
        name = "product_inquiry_id_counter"
