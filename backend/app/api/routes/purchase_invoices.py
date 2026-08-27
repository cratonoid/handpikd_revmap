# Purchase invoices module: endpoints for viewing/editing/voiding a purchase
# invoice, generating our own branded PDF for it, and attaching (or
# replacing) the vendor's own PDF. Purely a billing record: unlike
# create_new_purchase_order, nothing here touches inventory (see
# services/inventory.py::record_purchase_received) — that stays exclusively
# on the purchase-order-received flow. Restricted to admins (bypassed
# entirely when settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
#
# Nothing here creates a purchase invoice, and there is deliberately no
# endpoint that does: every purchase invoice is raised as part of creating
# the purchase order it belongs to (see create_new_purchase_order in
# routes/orders.py and services/purchase_invoices.py), whether that order was
# keyed in by hand or read off an uploaded vendor invoice PDF. A purchase
# invoice with no order behind it was never a valid record, so the create
# call that allowed one is gone rather than guarded.
#
# The vendor's own PDF is attached afterwards as its own request
# (attach_purchase_invoice_pdf) — same two-phase pattern as
# catalogues/products (see routes/catalogues.py's module docstring for why a
# file never travels bundled into another request). That endpoint doubles as
# "replace": if the invoice already has an uploaded PDF, the old file is
# hard-deleted from disk once the new one is saved and the record updated, so
# no history/versions are kept.
from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    PurchaseInvoiceDetails,
    PurchaseOrders,
    PurchaseSummary,
    User,
    VendorDetails,
    VendorPocDetails,
)
from app.schemas.purchase_invoices import (
    AttachPurchaseInvoicePdfResponse,
    PurchaseInvoiceDetailItem,
    UpdatePurchaseInvoiceDetailsRequest,
    UpdatePurchaseInvoiceDetailsResponse,
)
from app.services.invoice_numbering import format_purchase_invoice_no
from app.services.personal_details import get_personal_details
from app.services.purchase_invoice_pdf import PurchaseInvoiceLineItem, generate_purchase_invoice_pdf
from app.services.purchase_invoice_storage import delete_uploaded_pdf, read_uploaded_pdf, save_uploaded_pdf
from app.services.storage import LocalUploadBlockedError

router = APIRouter(prefix="/admin", tags=["purchase-invoices"])


async def _get_vendor_or_404(vendor_id: int) -> VendorDetails:
    vendor = await VendorDetails.get(vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")
    return vendor


async def _get_purchase_order_or_404(po_id: int) -> PurchaseOrders:
    purchase_order = await PurchaseOrders.get(po_id)
    if purchase_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase order not found")
    return purchase_order


@router.post("/attach_purchase_invoice_pdf", response_model=AttachPurchaseInvoicePdfResponse)
async def attach_purchase_invoice_pdf(
    purchase_invoice_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AttachPurchaseInvoicePdfResponse:
    purchase_invoice = await PurchaseInvoiceDetails.get(purchase_invoice_id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")

    # Captured before overwriting below — if this invoice already has an
    # uploaded PDF, this call replaces it: the old file is only removed once
    # the new one is safely saved and the record points at it, so a failure
    # partway through never loses the previous PDF.
    previous_pdf_path = purchase_invoice.uploaded_pdf_path

    pdf_bytes = await file.read()
    try:
        purchase_invoice.uploaded_pdf_path = save_uploaded_pdf(pdf_bytes)
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    await purchase_invoice.save()

    if previous_pdf_path is not None:
        delete_uploaded_pdf(previous_pdf_path)

    return AttachPurchaseInvoicePdfResponse(message="PDF attached successfully")


def _to_purchase_invoice_detail_item(purchase_invoice: PurchaseInvoiceDetails) -> PurchaseInvoiceDetailItem:
    return PurchaseInvoiceDetailItem(
        id=purchase_invoice.id,
        purchase_invoice_no=purchase_invoice.purchase_invoice_no,
        purchase_invoice_no_display=format_purchase_invoice_no(purchase_invoice.purchase_invoice_no),
        date=purchase_invoice.date,
        vendor_id=purchase_invoice.vendor_id,
        po_id=purchase_invoice.po_id,
        vendor_invoice_no=purchase_invoice.vendor_invoice_no,
        has_uploaded_pdf=purchase_invoice.uploaded_pdf_path is not None,
        total_amount_before_tax=purchase_invoice.total_amount_before_tax,
        total_tax_amount=purchase_invoice.total_tax_amount,
        total_amount_after_tax=purchase_invoice.total_amount_after_tax,
        is_deleted=purchase_invoice.is_deleted,
    )


@router.get("/get_purchase_invoice_details", response_model=list[PurchaseInvoiceDetailItem])
async def get_purchase_invoice_details(
    _: User | None = Depends(require_admin),
) -> list[PurchaseInvoiceDetailItem]:
    purchase_invoices = await PurchaseInvoiceDetails.find(PurchaseInvoiceDetails.is_deleted == False).to_list()
    return [_to_purchase_invoice_detail_item(purchase_invoice) for purchase_invoice in purchase_invoices]


@router.post("/update_purchase_invoice_details", response_model=UpdatePurchaseInvoiceDetailsResponse)
async def update_purchase_invoice_details(
    payload: UpdatePurchaseInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePurchaseInvoiceDetailsResponse:
    purchase_invoice = await PurchaseInvoiceDetails.get(payload.id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")

    purchase_invoice.date = payload.date
    purchase_invoice.is_deleted = payload.is_deleted
    await purchase_invoice.save()

    return UpdatePurchaseInvoiceDetailsResponse(message="purchase invoice updated successfully")


async def _build_purchase_invoice_line_items(purchase_order: PurchaseOrders) -> list[PurchaseInvoiceLineItem]:
    # Each line is taxed at its own rate, off its #purchase_summary row —
    # the same values _compute_totals in routes/orders.py summed to reach the
    # invoice's stored totals, so the rendered lines add back to them.
    # Falling back to the order's header rate covers rows written before
    # PurchaseSummary.gst_perc existed and somehow missed the backfill (see
    # _backfill_purchase_summary_gst in core/db.py).
    header_perc = (purchase_order.sgst_perc or 0) + (purchase_order.cgst_perc or 0) + (purchase_order.igst_perc or 0)

    summaries = await PurchaseSummary.find(PurchaseSummary.purchase_order_id == purchase_order.id).to_list()
    product_ids = [summary.product_id for summary in summaries]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    line_items = []
    for summary in summaries:
        product = products_by_id.get(summary.product_id)
        tax_perc = summary.gst_perc or header_perc
        taxable_value = summary.quantity * summary.rate
        tax_amount = taxable_value * (tax_perc / 100)
        line_items.append(
            PurchaseInvoiceLineItem(
                product_name=product.product_name if product else f"Product {summary.product_id}",
                hsn_code=product.hsn_code if product else "",
                quantity=summary.quantity,
                rate=summary.rate,
                taxable_value=taxable_value,
                tax_perc=tax_perc,
                tax_amount=tax_amount,
                total=taxable_value + tax_amount,
            )
        )
    return line_items


@router.get("/get_purchase_invoice_pdf")
async def get_purchase_invoice_pdf(
    purchase_invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    purchase_invoice = await PurchaseInvoiceDetails.get(purchase_invoice_id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")

    vendor = await _get_vendor_or_404(purchase_invoice.vendor_id)
    pocs = await VendorPocDetails.find(VendorPocDetails.vendor_id == vendor.id).to_list()
    vendor_phone = pocs[0].contact_phone if pocs else ""

    purchase_order = await _get_purchase_order_or_404(purchase_invoice.po_id)
    line_items = await _build_purchase_invoice_line_items(purchase_order)

    personal = await get_personal_details()
    purchase_invoice_no_display = format_purchase_invoice_no(purchase_invoice.purchase_invoice_no)

    pdf_bytes = await generate_purchase_invoice_pdf(
        purchase_invoice_no=purchase_invoice_no_display,
        invoice_date=purchase_invoice.date,
        line_items=line_items,
        total_amount_before_tax=purchase_invoice.total_amount_before_tax,
        total_tax_amount=purchase_invoice.total_tax_amount,
        total_amount_after_tax=purchase_invoice.total_amount_after_tax,
        vendor_name=vendor.registered_name,
        vendor_address=vendor.address,
        vendor_phone=vendor_phone,
        vendor_gstin=vendor.gst,
        personal=personal,
        # The heads the purchase order was placed under, snapshotted when
        # this invoice was raised (None for invoices predating that, which
        # the renderer still derives from the two GSTINs).
        tax_kind=purchase_invoice.tax_kind,
        place_of_supply_code=purchase_invoice.place_of_supply_code,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="purchase-invoice-{purchase_invoice_no_display}.pdf"'},
    )


@router.get("/get_purchase_invoice_uploaded_pdf")
async def get_purchase_invoice_uploaded_pdf(
    purchase_invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    purchase_invoice = await PurchaseInvoiceDetails.get(purchase_invoice_id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")
    if purchase_invoice.uploaded_pdf_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no uploaded PDF for this purchase invoice")

    pdf_bytes = read_uploaded_pdf(purchase_invoice.uploaded_pdf_path)
    if pdf_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="uploaded PDF file is missing")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="uploaded-purchase-invoice.pdf"'},
    )
