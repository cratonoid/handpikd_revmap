# Orders module: endpoints for placing purchase orders against a vendor's
# products, restricted to admins (bypassed entirely when settings.auth_enabled
# is False, matching require_admin in routes/admin.py).
#
# A purchase order can be started two ways, both landing on
# create_new_purchase_order below:
#   - keyed in by hand on the purchase order form, or
#   - read off the vendor's own invoice PDF by parse_purchase_invoice_pdf,
#     which writes nothing itself — it returns the values it read for the
#     admin to review in the same form before submitting. It refuses the
#     upload outright if the vendor, the invoice number or the totals can't
#     be trusted; a line item whose product it couldn't place comes back
#     unresolved for the admin to settle instead. See
#     services/purchase_invoice_intake.py.
# Either way the order raises its purchase invoice as part of being created,
# which is why /admin/create_new_purchase_invoice no longer exists: a
# purchase invoice always belongs to an order, so there was never a correct
# moment to create one on its own.
from beanie.operators import In
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    PurchaseInvoiceDetails,
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
    ParsedPurchaseInvoiceLineItem,
    ParsePurchaseInvoicePdfResponse,
    PurchaseOrderDetailItem,
    PurchaseOrderListItem,
    UpdatePurchaseOrderDetailsRequest,
    UpdatePurchaseOrderDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.invoice_extraction import InvoiceExtractionError
from app.services.inventory import (
    STOCK_IN,
    apply_purchase_order_stock,
    compute_stock_deltas,
    find_stock_shortfalls,
    get_applied_purchase_quantities,
    totals_by_product,
)
from app.services.purchase_invoice_intake import (
    DuplicateInvoiceError,
    InvoiceIntakeError,
    UnsupportedInvoiceError,
    read_uploaded_invoice,
)
from app.services.purchase_invoices import create_purchase_invoice_for_order

router = APIRouter(prefix="/admin", tags=["orders"])


async def _reject_duplicate_vendor_invoice(vendor_id: int, vendor_invoice_no: str | None) -> None:
    # The same rule parse_purchase_invoice_pdf applies to an upload (see
    # _reject_if_already_recorded), applied again here because that one runs
    # when the PDF is read and this runs when the order is finally saved —
    # and the two are as far apart as the admin's review takes. Nothing else
    # covers that window: the purchase order number check above is the wrong
    # key, since the number is editable on the form and an invoice recorded
    # under a different one still can't be recorded twice.
    #
    # Only uploads carry a vendor invoice number; orders keyed in by hand
    # have nothing to collide on.
    if not vendor_invoice_no:
        return

    existing = await PurchaseInvoiceDetails.find_one(
        PurchaseInvoiceDetails.vendor_id == vendor_id,
        PurchaseInvoiceDetails.vendor_invoice_no == vendor_invoice_no,
        PurchaseInvoiceDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison, not `is False`
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"invoice {vendor_invoice_no} from this vendor has already been recorded as "
                f"purchase invoice {existing.purchase_invoice_no}"
            ),
        )


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

    await _reject_duplicate_vendor_invoice(payload.vendor_id, payload.vendor_invoice_no)

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

    # Every purchase order raises its purchase invoice here, rather than the
    # admin raising one separately afterwards — see
    # services/purchase_invoices.py. The vendor's own PDF, if there is one,
    # is attached to this invoice in a follow-up request
    # (attach_purchase_invoice_pdf), which is why its id comes back.
    purchase_invoice = await create_purchase_invoice_for_order(purchase_order, payload.vendor_invoice_no)

    return CreateNewPurchaseOrderResponse(
        message="purchase order successfully created", purchase_invoice_id=purchase_invoice.id
    )


@router.post("/parse_purchase_invoice_pdf", response_model=ParsePurchaseInvoicePdfResponse)
async def parse_purchase_invoice_pdf(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> ParsePurchaseInvoicePdfResponse:
    # Read-only: this endpoint never writes anything. It either returns
    # values for the admin to review and submit through
    # create_new_purchase_order, or it refuses the upload — an invoice is
    # only ever half-understood, never half-recorded.
    pdf_bytes = await file.read()

    try:
        intake = await read_uploaded_invoice(pdf_bytes)
    except InvoiceExtractionError as error:
        # The PDF itself couldn't be read in full — the values aren't there
        # to argue with, so this is the upload being unusable rather than a
        # missing record.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    except DuplicateInvoiceError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    except UnsupportedInvoiceError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    except InvoiceIntakeError as error:
        # The vendor isn't on file — unlike an unmatched product, which comes
        # back as an unresolved line for the review screen to settle, there's
        # nothing to review without a vendor to hang the order on.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))

    return ParsePurchaseInvoicePdfResponse(
        vendor_id=intake.vendor_id,
        vendor_name=intake.vendor_name,
        vendor_gstin=intake.vendor_gstin,
        vendor_invoice_no=intake.invoice_no,
        date=intake.invoice_date,
        # The same parallel arrays create_new_purchase_order takes, so the
        # form can submit what it was handed without rebuilding it — except
        # where a line came back unresolved, whose product_id is null until
        # the admin picks or creates the product.
        product_ids=[item.product_id for item in intake.line_items],
        quantities=[item.quantity for item in intake.line_items],
        rates=[item.rate for item in intake.line_items],
        line_items=[
            ParsedPurchaseInvoiceLineItem(
                product_id=item.product_id,
                product_name=item.product_name,
                description=item.description,
                hsn_code=item.hsn_code,
                quantity=item.quantity,
                rate=item.rate,
                gst_perc=item.gst_perc,
                unresolved_reason=item.unresolved_reason,
            )
            for item in intake.line_items
        ],
        sgst_perc=intake.sgst_perc,
        cgst_perc=intake.cgst_perc,
        igst_perc=intake.igst_perc,
        total_amount_before_tax=intake.total_amount_before_tax,
        total_amount_after_tax=intake.total_amount_after_tax,
        printed_total=intake.printed_total,
        total_mismatch=intake.total_mismatch,
        source=intake.source,
    )


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
