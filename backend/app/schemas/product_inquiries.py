# Request/response bodies for the product inquiry module (the storefront
# cart's "Send inquiry" CTA at /cart, plus the admin screen that lists what
# came in).
from datetime import datetime

from pydantic import BaseModel


# One cart line as SENT by the visitor. Only the product id and quantity are
# taken from the request - the name and price are looked up server-side at
# submit time (see routes/product_inquiries.py), so a tampered/stale client
# can't record an inquiry against a price Handpikd never listed.
class SubmitProductInquiryItem(BaseModel):
    product_id: int
    quantity: int


class SubmitProductInquiryRequest(BaseModel):
    name: str
    email: str
    company: str
    phone: str | None = None
    message: str | None = None
    items: list[SubmitProductInquiryItem] = []


class SubmitProductInquiryResponse(BaseModel):
    message: str


class ProductInquiryItemDetail(BaseModel):
    product_id: int
    product_name: str
    unit_price: float
    quantity: int
    line_total: float


class ProductInquiryItemResponse(BaseModel):
    id: int
    name: str
    email: str
    company: str
    phone: str | None
    message: str | None
    total_amount: float
    created_at: datetime
    items: list[ProductInquiryItemDetail]
