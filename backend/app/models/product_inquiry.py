# Schema for the #product_inquiry collection: one row per "Send inquiry"
# submitted from the storefront cart page (/cart). `items` snapshots the
# product name and unit price AT SUBMISSION TIME (alongside the product id)
# for the same reason InquiryFormSubmission.selections does - a product can
# later be renamed, repriced, hidden, or deleted, and the inquiry still has to
# render in admin exactly as the visitor sent it.
from datetime import datetime

from beanie import Document
from pydantic import BaseModel


class ProductInquiryItem(BaseModel):
    product_id: int  # FK -> ProductDetails.id
    product_name: str
    unit_price: float  # ProductDetails.discounted_price at submission time
    quantity: int


class ProductInquiry(Document):
    id: int
    name: str
    email: str
    company: str
    phone: str | None = None
    message: str | None = None
    items: list[ProductInquiryItem] = []
    total_amount: float  # sum of unit_price * quantity across items, excluding GST
    created_at: datetime

    class Settings:
        name = "product_inquiry"
