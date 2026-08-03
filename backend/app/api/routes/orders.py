# Orders module: endpoints for placing purchase orders against a vendor's
# products, restricted to admins (bypassed entirely when settings.auth_enabled
# is False, matching require_admin in routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    PurchaseOrderIdCounter,
    PurchaseOrders,
    PurchaseSummary,
    PurchaseSummaryIdCounter,
    User,
    VendorDetails,
)
from app.schemas.purchase_orders import CreateNewPurchaseOrderRequest, CreateNewPurchaseOrderResponse
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin", tags=["orders"])


@router.post("/create_new_purchase_order", response_model=CreateNewPurchaseOrderResponse)
async def create_new_purchase_order(
    payload: CreateNewPurchaseOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewPurchaseOrderResponse:
    vendor = await VendorDetails.get(payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    existing_order = await PurchaseOrders.find_one(PurchaseOrders.purchase_order_no == payload.purchase_order_no)
    if existing_order is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="a purchase order with this number already exists"
        )

    products = await ProductDetails.find(In(ProductDetails.id, payload.product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in payload.product_ids:
        product = products_by_id.get(product_id)
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if product.vendor_id != payload.vendor_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"product {product_id} does not belong to the selected vendor",
            )

    total_amount_before_tax = sum(
        quantity * rate for quantity, rate in zip(payload.quantities, payload.rates)
    )
    total_amount_after_tax = (
        total_amount_before_tax
        + (payload.sgst_amount or 0)
        + (payload.cgst_amount or 0)
        + (payload.igst_amount or 0)
    )

    purchase_order_id = await get_next_id(PurchaseOrderIdCounter, "next_purchase_order_id", PurchaseOrders)
    purchase_order = PurchaseOrders(
        id=purchase_order_id,
        purchase_order_no=payload.purchase_order_no,
        vendor_id=payload.vendor_id,
        total_amount_before_tax=total_amount_before_tax,
        sgst_amount=payload.sgst_amount,
        cgst_amount=payload.cgst_amount,
        igst_amount=payload.igst_amount,
        total_amount_after_tax=total_amount_after_tax,
        description=payload.description,
    )
    await purchase_order.insert()

    for product_id, quantity, rate in zip(payload.product_ids, payload.quantities, payload.rates):
        summary_id = await get_next_id(PurchaseSummaryIdCounter, "next_purchase_summary_id", PurchaseSummary)
        await PurchaseSummary(
            id=summary_id,
            purchase_order_id=purchase_order_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
        ).insert()

    return CreateNewPurchaseOrderResponse(message="purchase order successfully created")
