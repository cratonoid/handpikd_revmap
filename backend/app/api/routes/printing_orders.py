# Printing orders module: endpoints for placing purchase orders against a
# PRINTING vendor's services, restricted to admins (bypassed entirely when
# settings.auth_enabled is False, matching require_admin in routes/admin.py).
#
# The printing counterpart of routes/orders.py, and it starts the same two
# ways — keyed in by hand, or read off the vendor's own invoice PDF by
# parse_printing_purchase_invoice_pdf, which writes nothing and returns the
# values it read for the admin to review before submitting. Either way the
# order raises its printing purchase invoice as part of being created, so
# there is no endpoint that creates one on its own.
#
# What this module deliberately does NOT do is the whole reason printing has
# its own collections: nothing here touches ProductDetails or #inventory.
# A printing line item is a service the vendor described ("Customized Print
# Service", "Sticker Printing A3 UV"), which resolves to no product of ours
# and moves no stock. Compare create_new_purchase_order next door, which
# validates every line against the vendor's catalogue and calls
# apply_purchase_order_stock — there is no equivalent of either call below,
# and there is nothing in this module's imports that could grow one by
# accident.
from beanie.operators import In
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    PrintingPurchaseInvoiceDetails,
    PrintingPurchaseOrderIdCounter,
    PrintingPurchaseOrders,
    PrintingPurchaseSummary,
    PrintingPurchaseSummaryIdCounter,
    User,
    VendorDetails,
)
from app.models.vendor_details import VendorType
from app.schemas.printing_purchase_orders import (
    CreateNewPrintingPurchaseOrderRequest,
    CreateNewPrintingPurchaseOrderResponse,
    ParsedPrintingInvoiceLineItem,
    ParsePrintingPurchaseInvoicePdfResponse,
    PrintingPurchaseOrderDetailItem,
    UpdatePrintingPurchaseOrderDetailsRequest,
    UpdatePrintingPurchaseOrderDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.gst import TaxKind, resolve_state_code, tax_kind_for
from app.services.invoice_extraction import InvoiceExtractionError
from app.services.personal_details import get_personal_details
from app.services.printing_purchase_invoice_intake import (
    DuplicateInvoiceError,
    InvoiceIntakeError,
    WrongVendorTypeError,
    read_uploaded_printing_invoice,
)
from app.services.printing_purchase_invoices import create_printing_purchase_invoice_for_order

router = APIRouter(prefix="/admin", tags=["printing-orders"])


async def _get_printing_vendor_or_error(vendor_id: int) -> VendorDetails:
    vendor = await VendorDetails.get(vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    # A purchase order has to be GST-invoiceable, same rule as the material
    # side's _require_vendor_has_gst.
    if not vendor.gst:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="selected vendor has no GST number on file — add one before placing a purchase order",
        )

    # And it has to be a printing vendor: this collection is what says a
    # purchase bought a service rather than stock, so a material vendor's
    # order landing here would be a purchase that silently never reached
    # #inventory. The form only offers printing vendors; this is the same
    # rule enforced where it can't be bypassed.
    if vendor.vendor_type != VendorType.printing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{vendor.registered_name} is not a printing vendor — place this order under "
                "Purchase orders / Material instead"
            ),
        )

    return vendor


async def _reject_duplicate_vendor_invoice(vendor_id: int, vendor_invoice_no: str | None) -> None:
    # The same rule parse_printing_purchase_invoice_pdf applies to an upload,
    # applied again here because that one runs when the PDF is read and this
    # runs when the order is finally saved — and the two are as far apart as
    # the admin's review takes. The purchase order number check is the wrong
    # key for it: the number is editable on the form, and an invoice recorded
    # under a different one still can't be recorded twice.
    #
    # Only uploads carry a vendor invoice number; orders keyed in by hand
    # have nothing to collide on.
    if not vendor_invoice_no:
        return

    existing = await PrintingPurchaseInvoiceDetails.find_one(
        PrintingPurchaseInvoiceDetails.vendor_id == vendor_id,
        PrintingPurchaseInvoiceDetails.vendor_invoice_no == vendor_invoice_no,
        PrintingPurchaseInvoiceDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"invoice {vendor_invoice_no} from this vendor has already been recorded as "
                f"printing purchase invoice {existing.printing_purchase_invoice_no}"
            ),
        )


def _compute_totals(quantities: list[int], rates: list[float], gst_percs: list[float]) -> tuple[float, float]:
    # Taxed line by line at each line's own rate, rather than by applying one
    # order-level percentage to the subtotal — identical to _compute_totals
    # in routes/orders.py, and for the same reason: the lines needn't agree.
    total_before_tax = sum(quantity * rate for quantity, rate in zip(quantities, rates))
    total_after_tax = sum(
        quantity * rate * (1 + gst_perc / 100)
        for quantity, rate, gst_perc in zip(quantities, rates, gst_percs)
    )
    return total_before_tax, total_after_tax


async def _resolve_tax_kind(
    payload: CreateNewPrintingPurchaseOrderRequest | UpdatePrintingPurchaseOrderDetailsRequest,
    vendor: VendorDetails,
) -> TaxKind:
    """Which heads this order's rates fall under.

    The payload's own choice wins — the form defaults it from the two states
    but lets the admin override it, for the cases the states can't express.
    With nothing sent, the two states decide.
    """
    if payload.tax_kind is not None:
        return payload.tax_kind

    personal = await get_personal_details()
    return tax_kind_for(
        resolve_state_code(vendor.state_code, vendor.gst),
        resolve_state_code(personal.get("state_code"), personal.get("gstin")),
    )


def _header_percs(gst_percs: list[float], tax_kind: TaxKind) -> tuple[float | None, float | None, float | None]:
    """The order's derived (sgst, cgst, igst) summary percentages.

    All None when the lines are taxed at different rates: no single
    percentage is true of such an order, and storing an average would be the
    blending this whole arrangement exists to avoid.
    """
    rates = set(gst_percs)
    if len(rates) != 1:
        return None, None, None

    rate = rates.pop()
    if not rate:
        return None, None, None
    if tax_kind == TaxKind.cgst_sgst:
        return rate / 2, rate / 2, None
    return None, None, rate


def _hsn_codes_for(payload: CreateNewPrintingPurchaseOrderRequest | UpdatePrintingPurchaseOrderDetailsRequest) -> list[str]:
    # Optional on the way in — plenty of printing bills print no SAC at all,
    # and a caller that sends nothing means "none of them have one" rather
    # than a length mismatch.
    return payload.hsn_codes if payload.hsn_codes is not None else [""] * len(payload.descriptions)


async def _insert_line_item_rows(
    printing_purchase_order_id: int,
    descriptions: list[str],
    hsn_codes: list[str],
    quantities: list[int],
    rates: list[float],
    gst_percs: list[float],
) -> None:
    for description, hsn_code, quantity, rate, gst_perc in zip(
        descriptions, hsn_codes, quantities, rates, gst_percs
    ):
        summary_id = await get_next_id(
            PrintingPurchaseSummaryIdCounter,
            "next_printing_purchase_summary_id",
            PrintingPurchaseSummary,
        )
        await PrintingPurchaseSummary(
            id=summary_id,
            printing_purchase_order_id=printing_purchase_order_id,
            description=description,
            hsn_code=hsn_code,
            quantity=quantity,
            rate=rate,
            gst_perc=gst_perc,
        ).insert()


@router.post("/create_new_printing_purchase_order", response_model=CreateNewPrintingPurchaseOrderResponse)
async def create_new_printing_purchase_order(
    payload: CreateNewPrintingPurchaseOrderRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewPrintingPurchaseOrderResponse:
    vendor = await _get_printing_vendor_or_error(payload.vendor_id)

    existing_order = await PrintingPurchaseOrders.find_one(
        PrintingPurchaseOrders.purchase_order_no == payload.purchase_order_no
    )
    if existing_order is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a printing purchase order with this number already exists",
        )

    await _reject_duplicate_vendor_invoice(payload.vendor_id, payload.vendor_invoice_no)

    tax_kind = await _resolve_tax_kind(payload, vendor)
    sgst_perc, cgst_perc, igst_perc = _header_percs(payload.gst_percs, tax_kind)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.gst_percs
    )

    printing_purchase_order_id = await get_next_id(
        PrintingPurchaseOrderIdCounter, "next_printing_purchase_order_id", PrintingPurchaseOrders
    )
    purchase_order = PrintingPurchaseOrders(
        id=printing_purchase_order_id,
        purchase_order_no=payload.purchase_order_no,
        vendor_id=payload.vendor_id,
        date=payload.date,
        total_amount_before_tax=total_amount_before_tax,
        tax_kind=tax_kind,
        sgst_perc=sgst_perc,
        cgst_perc=cgst_perc,
        igst_perc=igst_perc,
        total_amount_after_tax=total_amount_after_tax,
        description=payload.description,
    )
    await purchase_order.insert()

    await _insert_line_item_rows(
        printing_purchase_order_id,
        payload.descriptions,
        _hsn_codes_for(payload),
        payload.quantities,
        payload.rates,
        payload.gst_percs,
    )

    # No stock call here, and there should never be one — see this module's
    # docstring.
    printing_purchase_invoice = await create_printing_purchase_invoice_for_order(
        purchase_order, payload.vendor_invoice_no
    )

    return CreateNewPrintingPurchaseOrderResponse(
        message="printing purchase order successfully created",
        printing_purchase_invoice_id=printing_purchase_invoice.id,
    )


@router.post(
    "/parse_printing_purchase_invoice_pdf", response_model=ParsePrintingPurchaseInvoicePdfResponse
)
async def parse_printing_purchase_invoice_pdf(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> ParsePrintingPurchaseInvoicePdfResponse:
    # Read-only: this endpoint never writes anything. It either returns
    # values for the admin to review and submit through
    # create_new_printing_purchase_order, or it refuses the upload.
    pdf_bytes = await file.read()

    try:
        intake = await read_uploaded_printing_invoice(pdf_bytes)
    except InvoiceExtractionError as error:
        # The PDF itself couldn't be read in full — the values aren't there
        # to argue with, so this is the upload being unusable rather than a
        # missing record.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    except DuplicateInvoiceError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    except WrongVendorTypeError as error:
        # The vendor is on file, just not a printing one — the upload is in
        # the wrong place rather than unreadable, and the message says where
        # it belongs.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error))
    except InvoiceIntakeError as error:
        # The vendor isn't on file at all — there's nothing to review without
        # a vendor to hang the order on.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))

    return ParsePrintingPurchaseInvoicePdfResponse(
        vendor_id=intake.vendor_id,
        vendor_name=intake.vendor_name,
        vendor_gstin=intake.vendor_gstin,
        vendor_invoice_no=intake.invoice_no,
        date=intake.invoice_date,
        line_items=[
            ParsedPrintingInvoiceLineItem(
                description=item.description,
                hsn_code=item.hsn_code,
                quantity=item.quantity,
                rate=item.rate,
                gst_perc=item.gst_perc,
            )
            for item in intake.line_items
        ],
        tax_kind=intake.tax_kind,
        sgst_perc=intake.sgst_perc,
        cgst_perc=intake.cgst_perc,
        igst_perc=intake.igst_perc,
        total_amount_before_tax=intake.total_amount_before_tax,
        total_amount_after_tax=intake.total_amount_after_tax,
        printed_total=intake.printed_total,
        total_mismatch=intake.total_mismatch,
        source=intake.source,
    )


@router.get("/get_printing_purchase_order_details", response_model=list[PrintingPurchaseOrderDetailItem])
async def get_printing_purchase_order_details(
    _: User | None = Depends(require_admin),
) -> list[PrintingPurchaseOrderDetailItem]:
    orders = await PrintingPurchaseOrders.find_all().to_list()
    if not orders:
        return []

    order_ids = [order.id for order in orders]
    summaries = await PrintingPurchaseSummary.find(
        In(PrintingPurchaseSummary.printing_purchase_order_id, order_ids)
    ).to_list()
    summaries_by_order_id: dict[int, list[PrintingPurchaseSummary]] = {}
    for summary in summaries:
        summaries_by_order_id.setdefault(summary.printing_purchase_order_id, []).append(summary)

    response = []
    for order in orders:
        line_items = summaries_by_order_id.get(order.id, [])
        response.append(
            PrintingPurchaseOrderDetailItem(
                id=order.id,
                purchase_order_no=order.purchase_order_no,
                vendor_id=order.vendor_id,
                date=order.date,
                descriptions=[item.description for item in line_items],
                hsn_codes=[item.hsn_code for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                gst_percs=[item.gst_perc for item in line_items],
                total_amount_before_tax=order.total_amount_before_tax,
                tax_kind=order.tax_kind,
                sgst_perc=order.sgst_perc,
                cgst_perc=order.cgst_perc,
                igst_perc=order.igst_perc,
                total_amount_after_tax=order.total_amount_after_tax,
                description=order.description,
            )
        )

    return response


@router.post(
    "/update_printing_purchase_order_details", response_model=UpdatePrintingPurchaseOrderDetailsResponse
)
async def update_printing_purchase_order_details(
    payload: UpdatePrintingPurchaseOrderDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePrintingPurchaseOrderDetailsResponse:
    purchase_order = await PrintingPurchaseOrders.get(payload.id)
    if purchase_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="printing purchase order not found")

    vendor = await _get_printing_vendor_or_error(payload.vendor_id)

    existing_order = await PrintingPurchaseOrders.find_one(
        PrintingPurchaseOrders.purchase_order_no == payload.purchase_order_no
    )
    if existing_order is not None and existing_order.id != payload.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a printing purchase order with this number already exists",
        )

    tax_kind = await _resolve_tax_kind(payload, vendor)
    total_amount_before_tax, total_amount_after_tax = _compute_totals(
        payload.quantities, payload.rates, payload.gst_percs
    )

    purchase_order.purchase_order_no = payload.purchase_order_no
    purchase_order.vendor_id = payload.vendor_id
    purchase_order.date = payload.date
    purchase_order.total_amount_before_tax = total_amount_before_tax
    purchase_order.tax_kind = tax_kind
    purchase_order.sgst_perc, purchase_order.cgst_perc, purchase_order.igst_perc = _header_percs(
        payload.gst_percs, tax_kind
    )
    purchase_order.total_amount_after_tax = total_amount_after_tax
    purchase_order.description = payload.description
    await purchase_order.save()

    # Deleted and reinserted wholesale, same as the material side's line
    # items — there is no stock to reconcile first, so nothing has to be
    # computed against what the order previously said.
    #
    # The printing purchase invoice raised from this order is deliberately
    # NOT updated: it snapshots what the order said when it was raised, the
    # same borrowing convention PurchaseInvoiceDetails follows.
    await PrintingPurchaseSummary.find(
        PrintingPurchaseSummary.printing_purchase_order_id == purchase_order.id
    ).delete()
    await _insert_line_item_rows(
        purchase_order.id,
        payload.descriptions,
        _hsn_codes_for(payload),
        payload.quantities,
        payload.rates,
        payload.gst_percs,
    )

    return UpdatePrintingPurchaseOrderDetailsResponse(message="printing purchase order updated successfully")
