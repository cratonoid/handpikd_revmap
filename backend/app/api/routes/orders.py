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
    SalesOrders,
    User,
    VendorDetails,
)
from app.schemas.purchase_orders import (
    CreateNewPurchaseOrderRequest,
    CreateNewPurchaseOrderResponse,
    PurchaseOrderDetailItem,
    PurchaseOrderListItem,
    UpdatePurchaseOrderDetailsRequest,
    UpdatePurchaseOrderDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.inventory import (
    STOCK_IN,
    apply_purchase_order_stock,
    compute_stock_deltas,
    find_stock_shortfalls,
    get_applied_purchase_quantities,
    totals_by_product,
)

router = APIRouter(prefix="/admin", tags=["orders"])


def _require_vendor_has_gst(vendor: VendorDetails) -> None:
    # A purchase order needs to be GST-invoiceable, so it can only be placed
    # against a vendor with a GST number on file — mirrors the product form's
    # vendor picker (see routes/vendors.py's get_vendors_list comment), but
    # enforced here too since the PO endpoints are reachable independently of
    # that frontend filter.
    if not vendor.gst:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="selected vendor has no GST number on file — add one before placing a purchase order",
        )


async def _validate_products_belong_to_vendor(
    product_ids: list[int], vendor_id: int, reject_deleted: bool = False
) -> None:
    # reject_deleted is on for creates only — a soft-deleted product can't go
    # on a new purchase order, but an existing one that already lists one
    # still has to be editable. Same split as _validate_products_exist in
    # routes/quotations.py.
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in product_ids:
        product = products_by_id.get(product_id)
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if reject_deleted and product.is_deleted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"product {product_id} has been deleted"
            )
        if product.vendor_id != vendor_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"product {product_id} does not belong to the selected vendor",
            )


def _compute_totals(
    quantities: list[int],
    rates: list[float],
    sgst_perc: float | None,
    cgst_perc: float | None,
    igst_perc: float | None,
) -> tuple[float, float]:
    total_before_tax = sum(quantity * rate for quantity, rate in zip(quantities, rates))
    tax_perc = (sgst_perc or 0) + (cgst_perc or 0) + (igst_perc or 0)
    total_after_tax = total_before_tax * (1 + tax_perc / 100)
    return total_before_tax, total_after_tax


async def _reject_stock_going_negative(stock_deltas: dict[int, int]) -> None:
    # An edit that cuts a purchased quantity below what has since been sold
    # on would drive #inventory negative — the admin has to correct the
    # sales side first rather than have stock silently floored or inverted.
    shortfalls = await find_stock_shortfalls(stock_deltas)
    if not shortfalls:
        return

    details = ", ".join(
        f"product {product_id} (on hand {on_hand}, this edit removes {-delta})"
        for product_id, on_hand, delta in shortfalls
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"this edit would take stock negative for: {details}",
    )


async def _flag_related_sales_orders(purchase_order_id: int) -> None:
    # Notifies (doesn't auto-sync) any sales order that references this PO —
    # see SalesOrders.po_updated_flag's docstring for why: the two orders'
    # line items/totals are deliberately kept independent, so an edited PO
    # just raises a flag for the admin to review the linked sales order(s)
    # against, rather than silently overwriting their data.
    related_orders = await SalesOrders.find(
        SalesOrders.related_purchase_order_ids == purchase_order_id,
        SalesOrders.is_deleted == False,
    ).to_list()
    for sales_order in related_orders:
        sales_order.po_updated_flag = True
        await sales_order.save()


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
    _require_vendor_has_gst(vendor)

    existing_order = await PurchaseOrders.find_one(PurchaseOrders.purchase_order_no == payload.purchase_order_no)
    if existing_order is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="a purchase order with this number already exists"
        )

    await _validate_products_belong_to_vendor(payload.product_ids, payload.vendor_id, reject_deleted=True)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.sgst_perc, payload.cgst_perc, payload.igst_perc
    )

    purchase_order_id = await get_next_id(PurchaseOrderIdCounter, "next_purchase_order_id", PurchaseOrders)
    purchase_order = PurchaseOrders(
        id=purchase_order_id,
        purchase_order_no=payload.purchase_order_no,
        vendor_id=payload.vendor_id,
        date=payload.date,
        total_amount_before_tax=total_amount_before_tax,
        sgst_perc=payload.sgst_perc,
        cgst_perc=payload.cgst_perc,
        igst_perc=payload.igst_perc,
        total_amount_after_tax=total_amount_after_tax,
        description=payload.description,
    )
    await purchase_order.insert()

    await _insert_purchase_summary_rows(purchase_order_id, payload.product_ids, payload.quantities, payload.rates)
    # Nothing is applied yet for a brand new order, so the deltas are just
    # the ordered quantities — all of them stock coming in, never negative.
    await apply_purchase_order_stock(
        purchase_order_id,
        payload.product_ids,
        payload.quantities,
        totals_by_product(payload.product_ids, payload.quantities),
    )

    return CreateNewPurchaseOrderResponse(message="purchase order successfully created")


@router.get("/get_purchase_order_list", response_model=list[PurchaseOrderListItem])
async def get_purchase_order_list(
    _: User | None = Depends(require_admin),
) -> list[PurchaseOrderListItem]:
    # Lightweight id+PO no.+vendor name list for the sales order form's
    # "related purchase orders" multiselect. PurchaseOrders has no
    # is_deleted, so unlike get_vendors_list/get_customer_list this covers
    # every purchase order.
    orders = await PurchaseOrders.find_all().to_list()
    if not orders:
        return []

    vendor_ids = [order.vendor_id for order in orders]
    vendors = await VendorDetails.find(In(VendorDetails.id, vendor_ids)).to_list()
    vendor_names_by_id = {vendor.id: vendor.registered_name for vendor in vendors}

    return [
        PurchaseOrderListItem(
            id=order.id,
            purchase_order_no=order.purchase_order_no,
            vendor_name=vendor_names_by_id.get(order.vendor_id, "—"),
        )
        for order in orders
    ]


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
                date=order.date,
                product_ids=[item.product_id for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                total_amount_before_tax=order.total_amount_before_tax,
                sgst_perc=order.sgst_perc,
                cgst_perc=order.cgst_perc,
                igst_perc=order.igst_perc,
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
    _require_vendor_has_gst(vendor)

    existing_order = await PurchaseOrders.find_one(PurchaseOrders.purchase_order_no == payload.purchase_order_no)
    if existing_order is not None and existing_order.id != payload.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="a purchase order with this number already exists"
        )

    await _validate_products_belong_to_vendor(payload.product_ids, payload.vendor_id)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.sgst_perc, payload.cgst_perc, payload.igst_perc
    )

    purchase_order.purchase_order_no = payload.purchase_order_no
    purchase_order.vendor_id = payload.vendor_id
    purchase_order.date = payload.date
    purchase_order.total_amount_before_tax = total_amount_before_tax
    purchase_order.sgst_perc = payload.sgst_perc
    purchase_order.cgst_perc = payload.cgst_perc
    purchase_order.igst_perc = payload.igst_perc
    purchase_order.total_amount_after_tax = total_amount_after_tax
    # Stock moves by the difference between what this order has already added
    # to #inventory and what it adds after the edit, so raising a quantity
    # tops the product up and lowering one takes it back. Validated before
    # anything is written so a rejected edit leaves the order untouched.
    stock_deltas = compute_stock_deltas(
        await get_applied_purchase_quantities(purchase_order.id),
        totals_by_product(payload.product_ids, payload.quantities),
        STOCK_IN,
    )
    await _reject_stock_going_negative(stock_deltas)

    purchase_order.description = payload.description
    await purchase_order.save()

    await PurchaseSummary.find(PurchaseSummary.purchase_order_id == purchase_order.id).delete()
    await _insert_purchase_summary_rows(purchase_order.id, payload.product_ids, payload.quantities, payload.rates)
    await apply_purchase_order_stock(
        purchase_order.id, payload.product_ids, payload.quantities, stock_deltas
    )
    await _flag_related_sales_orders(purchase_order.id)

    return UpdatePurchaseOrderDetailsResponse(message="purchase order updated successfully")
