# Purchase invoices module: endpoints for raising purchase invoices either
# against an existing PurchaseOrders record (po_dropdown) or from an
# uploaded vendor PDF (pdf_upload, best-effort parsed — see
# purchase_invoice_parser.py), viewing/editing/voiding them, and generating
# PDFs. Purely a billing record: unlike create_new_purchase_order, nothing
# here touches inventory (see services/inventory.py::record_purchase_received)
# — that stays exclusively on the purchase-order-received flow. Restricted
# to admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
#
# Raising a pdf_upload invoice is a two-phase client flow (see
# purchase-invoice-form-modal.tsx's handleSubmit), same as catalogues/
# products: create_new_purchase_invoice first (date/vendor/line items only),
# then a separate attach_purchase_invoice_pdf call carrying the vendor PDF —
# see routes/catalogues.py's module docstring for why a file never travels
# bundled into the create request.
from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    PurchaseInvoiceDetails,
    PurchaseInvoiceIdCounter,
    PurchaseInvoiceNoCounterMaster,
    PurchaseInvoiceSource,
    PurchaseInvoiceSummary,
    PurchaseInvoiceSummaryIdCounter,
    PurchaseOrders,
    PurchaseSummary,
    User,
    VendorDetails,
    VendorPocDetails,
)
from app.schemas.purchase_invoices import (
    AttachPurchaseInvoicePdfResponse,
    CreateNewPurchaseInvoiceRequest,
    CreateNewPurchaseInvoiceResponse,
    ParsePurchaseInvoicePdfResponse,
    PurchaseInvoiceDetailItem,
    PurchaseInvoiceLineItemInput,
    UpdatePurchaseInvoiceDetailsRequest,
    UpdatePurchaseInvoiceDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.invoice_numbering import format_purchase_invoice_no
from app.services.personal_details import get_personal_details
from app.services.purchase_invoice_parser import parse_purchase_invoice_pdf
from app.services.purchase_invoice_pdf import PurchaseInvoiceLineItem, generate_purchase_invoice_pdf
from app.services.purchase_invoice_storage import read_uploaded_pdf, save_uploaded_pdf

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


def _compute_line_item_totals(
    items: list[PurchaseInvoiceLineItemInput],
) -> tuple[list[float], list[float], list[float], float, float, float]:
    taxable_values = [item.quantity * item.rate for item in items]
    tax_amounts = [taxable * (item.tax_perc / 100) for taxable, item in zip(taxable_values, items)]
    totals = [taxable + tax for taxable, tax in zip(taxable_values, tax_amounts)]
    total_before_tax = sum(taxable_values)
    total_tax = sum(tax_amounts)
    total_after_tax = total_before_tax + total_tax
    return taxable_values, tax_amounts, totals, total_before_tax, total_tax, total_after_tax


async def _insert_purchase_invoice_summary_rows(
    purchase_invoice_id: int, items: list[PurchaseInvoiceLineItemInput]
) -> None:
    _, tax_amounts, totals, *_ = _compute_line_item_totals(items)
    for item, tax_amount, total in zip(items, tax_amounts, totals):
        summary_id = await get_next_id(
            PurchaseInvoiceSummaryIdCounter, "next_purchase_invoice_summary_id", PurchaseInvoiceSummary
        )
        await PurchaseInvoiceSummary(
            id=summary_id,
            purchase_invoice_id=purchase_invoice_id,
            description=item.description,
            hsn_code=item.hsn_code,
            quantity=item.quantity,
            rate=item.rate,
            tax_perc=item.tax_perc,
            tax_amount=tax_amount,
            total=total,
        ).insert()


def _purchase_order_totals(purchase_order: PurchaseOrders) -> tuple[float, float, float]:
    total_tax = purchase_order.total_amount_after_tax - purchase_order.total_amount_before_tax
    return purchase_order.total_amount_before_tax, total_tax, purchase_order.total_amount_after_tax


@router.post("/parse_purchase_invoice_pdf", response_model=ParsePurchaseInvoicePdfResponse)
async def parse_purchase_invoice_pdf_endpoint(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> ParsePurchaseInvoicePdfResponse:
    pdf_bytes = await file.read()
    parsed = parse_purchase_invoice_pdf(pdf_bytes)

    if parsed.vendor_gstin:
        matched_vendor = await VendorDetails.find_one(VendorDetails.gst == parsed.vendor_gstin)
        if matched_vendor is not None:
            parsed.suggested_vendor_id = matched_vendor.id

    # Nothing saved to disk here — see attach_purchase_invoice_pdf below. A
    # parse the admin never turns into an actual invoice (closes the modal,
    # picks po_dropdown instead, etc.) leaves nothing behind.
    return ParsePurchaseInvoicePdfResponse(parsed=parsed)


@router.post("/create_new_purchase_invoice", response_model=CreateNewPurchaseInvoiceResponse)
async def create_new_purchase_invoice(
    payload: CreateNewPurchaseInvoiceRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewPurchaseInvoiceResponse:
    await _get_vendor_or_404(payload.vendor_id)

    if payload.source == PurchaseInvoiceSource.po_dropdown:
        purchase_order = await _get_purchase_order_or_404(payload.po_id)
        total_before_tax, total_tax, total_after_tax = _purchase_order_totals(purchase_order)
    else:
        *_, total_before_tax, total_tax, total_after_tax = _compute_line_item_totals(payload.line_items)

    purchase_invoice_no = await get_next_id(
        PurchaseInvoiceNoCounterMaster, "next_purchase_invoice_no", PurchaseInvoiceDetails
    )
    purchase_invoice_id = await get_next_id(
        PurchaseInvoiceIdCounter, "next_purchase_invoice_id", PurchaseInvoiceDetails
    )

    # uploaded_pdf_path starts unset — see attach_purchase_invoice_pdf below,
    # the only place it's ever written.
    purchase_invoice = PurchaseInvoiceDetails(
        id=purchase_invoice_id,
        purchase_invoice_no=purchase_invoice_no,
        date=payload.date,
        vendor_id=payload.vendor_id,
        po_id=payload.po_id,
        source=payload.source,
        uploaded_pdf_path=None,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
    )
    await purchase_invoice.insert()

    if payload.source == PurchaseInvoiceSource.pdf_upload:
        await _insert_purchase_invoice_summary_rows(purchase_invoice_id, payload.line_items)

    return CreateNewPurchaseInvoiceResponse(message="purchase invoice successfully created", id=purchase_invoice_id)


@router.post("/attach_purchase_invoice_pdf", response_model=AttachPurchaseInvoicePdfResponse)
async def attach_purchase_invoice_pdf(
    purchase_invoice_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AttachPurchaseInvoicePdfResponse:
    # Persists the vendor PDF for an already-created pdf_upload invoice —
    # see the module docstring above for why this is a separate call rather
    # than bundled into create_new_purchase_invoice.
    purchase_invoice = await PurchaseInvoiceDetails.get(purchase_invoice_id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")
    if purchase_invoice.source != PurchaseInvoiceSource.pdf_upload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="this invoice has no PDF to attach")

    pdf_bytes = await file.read()
    purchase_invoice.uploaded_pdf_path = save_uploaded_pdf(pdf_bytes)
    await purchase_invoice.save()

    return AttachPurchaseInvoicePdfResponse(message="PDF attached successfully")


def _to_purchase_invoice_detail_item(
    purchase_invoice: PurchaseInvoiceDetails, line_items: list[PurchaseInvoiceSummary]
) -> PurchaseInvoiceDetailItem:
    return PurchaseInvoiceDetailItem(
        id=purchase_invoice.id,
        purchase_invoice_no=purchase_invoice.purchase_invoice_no,
        purchase_invoice_no_display=format_purchase_invoice_no(purchase_invoice.purchase_invoice_no),
        date=purchase_invoice.date,
        vendor_id=purchase_invoice.vendor_id,
        po_id=purchase_invoice.po_id,
        source=purchase_invoice.source,
        has_uploaded_pdf=purchase_invoice.uploaded_pdf_path is not None,
        line_items=[
            PurchaseInvoiceLineItemInput(
                description=item.description,
                hsn_code=item.hsn_code,
                quantity=item.quantity,
                rate=item.rate,
                tax_perc=item.tax_perc,
            )
            for item in line_items
        ],
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
    if not purchase_invoices:
        return []

    purchase_invoice_ids = [purchase_invoice.id for purchase_invoice in purchase_invoices]
    summaries = await PurchaseInvoiceSummary.find(
        In(PurchaseInvoiceSummary.purchase_invoice_id, purchase_invoice_ids)
    ).to_list()
    summaries_by_purchase_invoice_id: dict[int, list[PurchaseInvoiceSummary]] = {}
    for summary in summaries:
        summaries_by_purchase_invoice_id.setdefault(summary.purchase_invoice_id, []).append(summary)

    return [
        _to_purchase_invoice_detail_item(
            purchase_invoice, summaries_by_purchase_invoice_id.get(purchase_invoice.id, [])
        )
        for purchase_invoice in purchase_invoices
    ]


@router.post("/update_purchase_invoice_details", response_model=UpdatePurchaseInvoiceDetailsResponse)
async def update_purchase_invoice_details(
    payload: UpdatePurchaseInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePurchaseInvoiceDetailsResponse:
    purchase_invoice = await PurchaseInvoiceDetails.get(payload.id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")

    await _get_vendor_or_404(payload.vendor_id)

    if purchase_invoice.source == PurchaseInvoiceSource.po_dropdown:
        purchase_order = await _get_purchase_order_or_404(purchase_invoice.po_id)
        total_before_tax, total_tax, total_after_tax = _purchase_order_totals(purchase_order)
    else:
        if not payload.line_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="at least one line item is required"
            )
        *_, total_before_tax, total_tax, total_after_tax = _compute_line_item_totals(payload.line_items)
        await PurchaseInvoiceSummary.find(
            PurchaseInvoiceSummary.purchase_invoice_id == purchase_invoice.id
        ).delete()
        await _insert_purchase_invoice_summary_rows(purchase_invoice.id, payload.line_items)

    purchase_invoice.date = payload.date
    purchase_invoice.vendor_id = payload.vendor_id
    purchase_invoice.total_amount_before_tax = total_before_tax
    purchase_invoice.total_tax_amount = total_tax
    purchase_invoice.total_amount_after_tax = total_after_tax
    purchase_invoice.is_deleted = payload.is_deleted
    await purchase_invoice.save()

    return UpdatePurchaseInvoiceDetailsResponse(message="purchase invoice updated successfully")


async def _build_po_dropdown_line_items(purchase_order: PurchaseOrders) -> list[PurchaseInvoiceLineItem]:
    # PurchaseSummary carries no per-line tax (GST on PurchaseOrders is
    # header-level) — synthesize each line's tax_perc as the order's
    # combined GST %, same blended-rate convention _compute_totals in
    # routes/orders.py already uses.
    tax_perc = (purchase_order.sgst_perc or 0) + (purchase_order.cgst_perc or 0) + (purchase_order.igst_perc or 0)

    summaries = await PurchaseSummary.find(PurchaseSummary.purchase_order_id == purchase_order.id).to_list()
    product_ids = [summary.product_id for summary in summaries]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    line_items = []
    for summary in summaries:
        product = products_by_id.get(summary.product_id)
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


async def _build_pdf_upload_line_items(purchase_invoice_id: int) -> list[PurchaseInvoiceLineItem]:
    summaries = await PurchaseInvoiceSummary.find(
        PurchaseInvoiceSummary.purchase_invoice_id == purchase_invoice_id
    ).to_list()
    return [
        PurchaseInvoiceLineItem(
            product_name=summary.description,
            hsn_code=summary.hsn_code,
            quantity=summary.quantity,
            rate=summary.rate,
            taxable_value=summary.quantity * summary.rate,
            tax_perc=summary.tax_perc,
            tax_amount=summary.tax_amount,
            total=summary.total,
        )
        for summary in summaries
    ]


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

    if purchase_invoice.source == PurchaseInvoiceSource.po_dropdown:
        purchase_order = await _get_purchase_order_or_404(purchase_invoice.po_id)
        line_items = await _build_po_dropdown_line_items(purchase_order)
    else:
        line_items = await _build_pdf_upload_line_items(purchase_invoice.id)

    personal = await get_personal_details()
    purchase_invoice_no_display = format_purchase_invoice_no(purchase_invoice.purchase_invoice_no)

    pdf_bytes = generate_purchase_invoice_pdf(
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
