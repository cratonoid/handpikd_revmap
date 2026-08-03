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
from app.schemas.purchase_orders import (
    CreateNewPurchaseOrderRequest,
    CreateNewPurchaseOrderResponse,
    PurchaseOrderDetailItem,
    UpdatePurchaseOrderDetailsRequest,
    UpdatePurchaseOrderDetailsResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin", tags=["orders"])


async def _validate_products_belong_to_vendor(product_ids: list[int], vendor_id: int) -> None:
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in product_ids:
        product = products_by_id.get(product_id)
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if product.vendor_id != vendor_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"product {product_id} does not belong to the selected vendor",
            )


def _compute_totals(
    quantities: list[int],
    rates: list[float],
    sgst_amount: float | None,
    cgst_amount: float | None,
    igst_amount: float | None,
) -> tuple[float, float]:
    total_before_tax = sum(quantity * rate for quantity, rate in zip(quantities, rates))
    total_after_tax = total_before_tax + (sgst_amount or 0) + (cgst_amount or 0) + (igst_amount or 0)
    return total_before_tax, total_after_tax


async def _insert_purchase_summary_rows(
    purchase_order_id: int, product_ids: list[int], quantities: list[int], rates: list[float]
) -> None:
    for product_id, quantity, rate in zip(product_ids, quantities, rates):
        summary_id = await get_next_id(PurchaseSummaryIdCounter, "next_purchase_summary_id", PurchaseSummary)
        await PurchaseSummary(
            id=summary_id,
            purchase_order_id=purchase_order_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
        ).insert()


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

    await _validate_products_belong_to_vendor(payload.product_ids, payload.vendor_id)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.sgst_amount, payload.cgst_amount, payload.igst_amount
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

    await _insert_purchase_summary_rows(purchase_order_id, payload.product_ids, payload.quantities, payload.rates)

    return CreateNewPurchaseOrderResponse(message="purchase order successfully created")


@router.get("/get_purchase_order_details", response_model=list[PurchaseOrderDetailItem])
async def get_purchase_order_details(
    _: User | None = Depends(require_admin),
) -> list[PurchaseOrderDetailItem]:
    orders = await PurchaseOrders.find_all().to_list()
    if not orders:
        return []

    order_ids = [order.id for order in orders]
    summaries = await PurchaseSummary.find(In(PurchaseSummary.purchase_order_id, order_ids)).to_list()
    summaries_by_order_id: dict[int, list[PurchaseSummary]] = {}
    for summary in summaries:
        summaries_by_order_id.setdefault(summary.purchase_order_id, []).append(summary)

    response = []
    for order in orders:
        line_items = summaries_by_order_id.get(order.id, [])
        response.append(
            PurchaseOrderDetailItem(
                id=order.id,
                purchase_order_no=order.purchase_order_no,
                vendor_id=order.vendor_id,
                product_ids=[item.product_id for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                total_amount_before_tax=order.total_amount_before_tax,
                sgst_amount=order.sgst_amount,
                cgst_amount=order.cgst_amount,
                igst_amount=order.igst_amount,
                total_amount_after_tax=order.total_amount_after_tax,
                description=order.description,
            )
        )

    return response


@router.post("/update_purchase_order_details", response_model=UpdatePurchaseOrderDetailsResponse)
async def update_purchase_order_details(
    payload: UpdatePurchaseOrderDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePurchaseOrderDetailsResponse:
    purchase_order = await PurchaseOrders.get(payload.id)
    if purchase_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase order not found")

    vendor = await VendorDetails.get(payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    existing_order = await PurchaseOrders.find_one(PurchaseOrders.purchase_order_no == payload.purchase_order_no)
    if existing_order is not None and existing_order.id != payload.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="a purchase order with this number already exists"
        )

    await _validate_products_belong_to_vendor(payload.product_ids, payload.vendor_id)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.sgst_amount, payload.cgst_amount, payload.igst_amount
    )

    purchase_order.purchase_order_no = payload.purchase_order_no
    purchase_order.vendor_id = payload.vendor_id
    purchase_order.total_amount_before_tax = total_amount_before_tax
    purchase_order.sgst_amount = payload.sgst_amount
    purchase_order.cgst_amount = payload.cgst_amount
    purchase_order.igst_amount = payload.igst_amount
    purchase_order.total_amount_after_tax = total_amount_after_tax
    purchase_order.description = payload.description
    await purchase_order.save()

    await PurchaseSummary.find(PurchaseSummary.purchase_order_id == purchase_order.id).delete()
    await _insert_purchase_summary_rows(purchase_order.id, payload.product_ids, payload.quantities, payload.rates)

    return UpdatePurchaseOrderDetailsResponse(message="purchase order updated successfully")
