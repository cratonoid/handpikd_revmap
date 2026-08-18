# Product inquiry module: what the storefront cart (/cart) sends when a
# visitor presses "Send inquiry" on the products they collected, plus the
# admin endpoint that lists those inquiries. Same router split as
# routes/inquiry_form.py - `router` sits behind require_admin (bypassed
# entirely when settings.auth_enabled is False, matching require_admin in
# routes/admin.py), while `public_router` is intentionally unauthenticated
# since the cart page is a visitor-facing surface with no login.
from datetime import datetime, timezone

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    ProductInquiry,
    ProductInquiryIdCounter,
    ProductInquiryItem,
    User,
)
from app.schemas.product_inquiries import (
    ProductInquiryItemDetail,
    ProductInquiryItemResponse,
    SubmitProductInquiryRequest,
    SubmitProductInquiryResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/product-inquiries", tags=["product-inquiries"])

public_router = APIRouter(prefix="/product-inquiries", tags=["product-inquiries-public"])


@public_router.post("/submit", response_model=SubmitProductInquiryResponse)
async def submit_product_inquiry(payload: SubmitProductInquiryRequest) -> SubmitProductInquiryResponse:
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
    if not payload.email.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="email is required")
    if not payload.company.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="company is required")
    if not payload.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cart is empty")

    # Collapse duplicate lines for the same product (a client bug or a
    # hand-crafted request could send the same id twice) by summing their
    # quantities, so one inquiry always has at most one row per product.
    quantities: dict[int, int] = {}
    for item in payload.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="quantity must be positive")
        quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity

    products = await ProductDetails.find(In(ProductDetails.id, list(quantities.keys()))).to_list()
    products_by_id = {product.id: product for product in products}

    # Only products the storefront actually offers (is_visible and not
    # is_deleted, same filter as get_public_products in routes/products.py)
    # can be inquired about.
    missing = [
        product_id
        for product_id in quantities
        if product_id not in products_by_id
        or not products_by_id[product_id].is_visible
        or products_by_id[product_id].is_deleted
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="one or more products in your cart are no longer available",
        )

    items = [
        ProductInquiryItem(
            product_id=product_id,
            product_name=products_by_id[product_id].product_name,
            unit_price=products_by_id[product_id].discounted_price,
            quantity=quantity,
        )
        for product_id, quantity in quantities.items()
    ]
    total_amount = sum(item.unit_price * item.quantity for item in items)

    inquiry_id = await get_next_id(ProductInquiryIdCounter, "next_product_inquiry_id", ProductInquiry)
    inquiry = ProductInquiry(
        id=inquiry_id,
        name=payload.name.strip(),
        email=payload.email.strip(),
        company=payload.company.strip(),
        phone=(payload.phone or "").strip() or None,
        message=(payload.message or "").strip() or None,
        items=items,
        total_amount=total_amount,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    await inquiry.insert()

    return SubmitProductInquiryResponse(message="inquiry submitted successfully")


@router.get("/get_inquiries", response_model=list[ProductInquiryItemResponse])
async def get_inquiries(_: User | None = Depends(require_admin)) -> list[ProductInquiryItemResponse]:
    inquiries = await ProductInquiry.find_all().sort(-ProductInquiry.id).to_list()
    return [
        ProductInquiryItemResponse(
            id=inquiry.id,
            name=inquiry.name,
            email=inquiry.email,
            company=inquiry.company,
            phone=inquiry.phone,
            message=inquiry.message,
            total_amount=inquiry.total_amount,
            created_at=inquiry.created_at,
            items=[
                ProductInquiryItemDetail(
                    product_id=item.product_id,
                    product_name=item.product_name,
                    unit_price=item.unit_price,
                    quantity=item.quantity,
                    line_total=item.unit_price * item.quantity,
                )
                for item in inquiry.items
            ],
        )
        for inquiry in inquiries
    ]
