# Quotations module: endpoints for drafting quotations directly against
# products (unlike invoices, a quotation carries its own line items — see
# QuotationSummary — rather than being raised against an existing sales
# order) and generating their PDFs. Restricted to admins (bypassed entirely
# when settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    CustomerPocDetails,
    InvoiceDetails,
    InvoiceIdCounter,
    InvoiceType,
    OnlineOrOffline,
    ProductDetails,
    ProductImageDetails,
    ProformaInvoiceNoCounterMaster,
    QuotationDetails,
    QuotationIdCounter,
    QuotationNoCounterMaster,
    QuotationStatus,
    QuotationSummary,
    QuotationSummaryIdCounter,
    User,
)
from app.schemas.quotations import (
    CreateNewQuotationRequest,
    CreateNewQuotationResponse,
    QuotationDetailItem,
    UpdateQuotationDetailsRequest,
    UpdateQuotationDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.personal_details import get_personal_details
from app.services.quotation_pdf import QuotationLineItem, generate_quotation_pdf

router = APIRouter(prefix="/admin", tags=["quotations"])


async def _validate_customer_exists(cust_id: int) -> None:
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")


async def _validate_products_exist(product_ids: list[int]) -> None:
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    found_ids = {product.id for product in products}
    for product_id in product_ids:
        if product_id not in found_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")


def _compute_line_items_and_totals(
    quantities: list[int], rates: list[float], tax_percs: list[float]
) -> tuple[list[float], list[float], float, float, float]:
    line_totals_before_tax = [quantity * rate for quantity, rate in zip(quantities, rates)]
    tax_amounts = [
        line_total * (tax_perc / 100) for line_total, tax_perc in zip(line_totals_before_tax, tax_percs)
    ]
    total_before_tax = sum(line_totals_before_tax)
    total_tax = sum(tax_amounts)
    total_after_tax = total_before_tax + total_tax
    return line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax


async def _insert_quotation_summary_rows(
    quotation_id: int,
    product_ids: list[int],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    tax_amounts: list[float],
    line_totals_before_tax: list[float],
) -> None:
    for product_id, quantity, rate, tax_perc, tax_amount, line_total_before_tax in zip(
        product_ids, quantities, rates, tax_percs, tax_amounts, line_totals_before_tax
    ):
        summary_id = await get_next_id(QuotationSummaryIdCounter, "next_quotation_summary_id", QuotationSummary)
        await QuotationSummary(
            id=summary_id,
            quotation_id=quotation_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
            tax_perc=tax_perc,
            tax_amount=tax_amount,
            total=line_total_before_tax + tax_amount,
        ).insert()


async def _maybe_create_proforma_invoice(quotation: QuotationDetails) -> None:
    # Idempotency guard: never generate a second proforma if one already
    # exists for this quotation (e.g. admin flips status away from
    # "accepted" and back, or saves the same "accepted" status twice).
    existing = await InvoiceDetails.find_one(
        InvoiceDetails.quotation_id == quotation.id,
        InvoiceDetails.type == InvoiceType.proforma,
        InvoiceDetails.is_deleted == False,
    )
    if existing is not None:
        return

    invoice_no = await get_next_id(ProformaInvoiceNoCounterMaster, "next_invoice_no", InvoiceDetails)
    invoice_id = await get_next_id(InvoiceIdCounter, "next_invoice_id", InvoiceDetails)

    await InvoiceDetails(
        id=invoice_id,
        invoice_no=invoice_no,
        date=quotation.date,
        sales_id=None,
        quotation_id=quotation.id,
        total_amount_before_tax=quotation.total_amount_before_tax,
        total_tax_amount=quotation.total_tax_amount,
        total_amount_after_tax=quotation.total_amount_after_tax,
        type=InvoiceType.proforma,
        due_date=quotation.valid_till,
        online_or_offline=OnlineOrOffline.offline,
        transport="",
    ).insert()


@router.post("/create_new_quotation", response_model=CreateNewQuotationResponse)
async def create_new_quotation(
    payload: CreateNewQuotationRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewQuotationResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

    quotation_no = await get_next_id(QuotationNoCounterMaster, "next_quotation_no", QuotationDetails)
    quotation_id = await get_next_id(QuotationIdCounter, "next_quotation_id", QuotationDetails)

    quotation = QuotationDetails(
        id=quotation_id,
        quotation_no=quotation_no,
        date=payload.date,
        valid_till=payload.valid_till,
        cust_id=payload.cust_id,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        description=payload.description,
    )
    await quotation.insert()

    await _insert_quotation_summary_rows(
        quotation_id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_totals_before_tax,
    )

    # Unlike most other create_* endpoints here, the response carries the new
    # row's id/quotation_no (not just {message}) — the frontend's "Generate"
    # button needs the id immediately to chain straight into
    # GET /admin/get_quotation_pdf without a second round trip to re-fetch
    # the list and guess which row is the new one.
    return CreateNewQuotationResponse(
        message="quotation successfully created", id=quotation_id, quotation_no=quotation_no
    )


@router.get("/get_quotation_details", response_model=list[QuotationDetailItem])
async def get_quotation_details(
    _: User | None = Depends(require_admin),
) -> list[QuotationDetailItem]:
    quotations = await QuotationDetails.find(QuotationDetails.is_deleted == False).to_list()
    if not quotations:
        return []

    quotation_ids = [quotation.id for quotation in quotations]
    summaries = await QuotationSummary.find(In(QuotationSummary.quotation_id, quotation_ids)).to_list()
    summaries_by_quotation_id: dict[int, list[QuotationSummary]] = {}
    for summary in summaries:
        summaries_by_quotation_id.setdefault(summary.quotation_id, []).append(summary)

    response = []
    for quotation in quotations:
        line_items = summaries_by_quotation_id.get(quotation.id, [])
        response.append(
            QuotationDetailItem(
                id=quotation.id,
                quotation_no=quotation.quotation_no,
                date=quotation.date,
                valid_till=quotation.valid_till,
                cust_id=quotation.cust_id,
                status=quotation.status,
                product_ids=[item.product_id for item in line_items],
                quantities=[item.quantity for item in line_items],
                rates=[item.rate for item in line_items],
                tax_percs=[item.tax_perc for item in line_items],
                total_amount_before_tax=quotation.total_amount_before_tax,
                total_tax_amount=quotation.total_tax_amount,
                total_amount_after_tax=quotation.total_amount_after_tax,
                description=quotation.description,
                is_deleted=quotation.is_deleted,
            )
        )

    return response


@router.post("/update_quotation_details", response_model=UpdateQuotationDetailsResponse)
async def update_quotation_details(
    payload: UpdateQuotationDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateQuotationDetailsResponse:
    quotation = await QuotationDetails.get(payload.id)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="quotation not found")

    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

    old_status = quotation.status
    quotation.status = payload.status
    quotation.cust_id = payload.cust_id
    quotation.date = payload.date
    quotation.valid_till = payload.valid_till
    quotation.total_amount_before_tax = total_before_tax
    quotation.total_tax_amount = total_tax
    quotation.total_amount_after_tax = total_after_tax
    quotation.description = payload.description
    quotation.is_deleted = payload.is_deleted
    await quotation.save()

    await QuotationSummary.find(QuotationSummary.quotation_id == quotation.id).delete()
    await _insert_quotation_summary_rows(
        quotation.id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_totals_before_tax,
    )

    # A proforma invoice is a mock invoice generated the moment a quotation
    # is accepted — no manual step. Only fires on the transition *into*
    # accepted, and _maybe_create_proforma_invoice is itself idempotent.
    if old_status != QuotationStatus.accepted and quotation.status == QuotationStatus.accepted:
        await _maybe_create_proforma_invoice(quotation)

    return UpdateQuotationDetailsResponse(message="quotation updated successfully")


@router.get("/get_quotation_pdf")
async def get_quotation_pdf(
    quotation_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    quotation = await QuotationDetails.get(quotation_id)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="quotation not found")

    customer = await CustomerDetails.get(quotation.cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    pocs = await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).to_list()
    customer_phone = pocs[0].contact_phone if pocs else ""

    summaries = await QuotationSummary.find(QuotationSummary.quotation_id == quotation.id).to_list()
    product_ids = [summary.product_id for summary in summaries]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    # First image per product, same "one representative thumbnail" convention
    # as get_product_details — the quotation table shows a small thumbnail
    # next to each line item rather than every image on file.
    images = await ProductImageDetails.find(In(ProductImageDetails.product_id, product_ids)).to_list()
    first_image_by_product_id: dict[int, str] = {}
    for image in images:
        first_image_by_product_id.setdefault(image.product_id, image.image_path)

    line_items = [
        QuotationLineItem(
            product_name=products_by_id[summary.product_id].product_name
            if summary.product_id in products_by_id
            else f"Product {summary.product_id}",
            image_path=first_image_by_product_id.get(summary.product_id),
            unit_price=products_by_id[summary.product_id].actual_price
            if summary.product_id in products_by_id
            else summary.rate,
            rate=summary.rate,
            quantity=summary.quantity,
            tax_perc=summary.tax_perc,
            total=summary.total,
        )
        for summary in summaries
    ]

    personal = await get_personal_details()

    pdf_bytes = await generate_quotation_pdf(
        quotation_no=quotation.quotation_no,
        quotation_date=quotation.date,
        valid_till=quotation.valid_till,
        status=quotation.status.value,
        line_items=line_items,
        total_amount_before_tax=quotation.total_amount_before_tax,
        total_tax_amount=quotation.total_tax_amount,
        total_amount_after_tax=quotation.total_amount_after_tax,
        description=quotation.description,
        customer_name=customer.registered_name,
        customer_address=customer.address,
        customer_phone=customer_phone,
        customer_gstin=customer.company_gst,
        personal=personal,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="quotation-{quotation.quotation_no}.pdf"'},
    )
