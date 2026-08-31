# Quotations module: endpoints for drafting quotations directly against
# products (unlike invoices, a quotation carries its own line items — see
# QuotationSummary — rather than being raised against an existing sales
# order) and generating their PDFs. Restricted to admins (bypassed entirely
# when settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
#
# A quotation is the one document here that doesn't have to be built out
# of rows that already exist: its buyer is either a #customer_details
# client or a one-off name/address typed into the form, and each line is
# either a catalogue product or a one-off name/image. Neither one-off is
# written back to #customer_details/#product_details — quoting a prospect
# for something not yet in the catalogue shouldn't leave junk rows behind
# — so both are snapshotted onto the quotation itself and rendered
# straight from there.
from datetime import datetime

from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    CustomerPocDetails,
    ProductDetails,
    ProductImageDetails,
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


async def _validate_customer_exists(cust_id: int | None) -> None:
    # None means the quotation carries a one-off buyer instead of pointing
    # at a client row, so there's nothing to look up. The schema already
    # guarantees a customer_name in that case.
    if cust_id is None:
        return
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")


async def _validate_products_exist(product_ids: list[int | None], reject_deleted: bool = False) -> None:
    # reject_deleted is on for creates only. A soft-deleted product must not
    # be pickable on something new (it isn't offered by the frontend's picker
    # either — see the isDeleted filter in the form modals), but an existing
    # document that already lists one still has to be editable, so updates
    # only check that the product exists at all.
    #
    # None entries are one-off lines, which point at no catalogue row at
    # all — they're dropped here and validated by the schema instead.
    product_ids = [product_id for product_id in product_ids if product_id is not None]
    if not product_ids:
        return
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in product_ids:
        if product_id not in products_by_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if reject_deleted and products_by_id[product_id].is_deleted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"product {product_id} has been deleted"
            )


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
    product_ids: list[int | None],
    product_names: list[str],
    image_paths: list[str | None],
    quantities: list[int],
    rates: list[float],
    tax_percs: list[float],
    tax_amounts: list[float],
    line_totals_before_tax: list[float],
) -> None:
    for (
        product_id,
        product_name,
        image_path,
        quantity,
        rate,
        tax_perc,
        tax_amount,
        line_total_before_tax,
    ) in zip(
        product_ids,
        product_names,
        image_paths,
        quantities,
        rates,
        tax_percs,
        tax_amounts,
        line_totals_before_tax,
    ):
        summary_id = await get_next_id(QuotationSummaryIdCounter, "next_quotation_summary_id", QuotationSummary)
        await QuotationSummary(
            id=summary_id,
            quotation_id=quotation_id,
            product_id=product_id,
            # Only ever populated on a one-off line — a catalogue line reads
            # its name/image off ProductDetails at PDF time instead.
            product_name=product_name.strip() if product_id is None else "",
            image_path=(image_path or None) if product_id is None else None,
            quantity=quantity,
            rate=rate,
            tax_perc=tax_perc,
            tax_amount=tax_amount,
            total=line_total_before_tax + tax_amount,
        ).insert()


@router.post("/create_new_quotation", response_model=CreateNewQuotationResponse)
async def create_new_quotation(
    payload: CreateNewQuotationRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewQuotationResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids, reject_deleted=True)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

    quotation_no = await get_next_id(QuotationNoCounterMaster, "next_quotation_no", QuotationDetails)
    quotation_id = await get_next_id(QuotationIdCounter, "next_quotation_id", QuotationDetails)

    quotation = QuotationDetails(
        id=quotation_id,
        quotation_no=quotation_no,
        date=datetime.combine(payload.date, datetime.min.time()),
        valid_till=datetime.combine(payload.valid_till, datetime.min.time()),
        cust_id=payload.cust_id,
        customer_name=payload.customer_name.strip() if payload.cust_id is None else "",
        customer_address=payload.customer_address.strip() if payload.cust_id is None else "",
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        description=payload.description,
    )
    await quotation.insert()

    await _insert_quotation_summary_rows(
        quotation_id,
        payload.product_ids,
        payload.product_names,
        payload.image_paths,
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
                date=quotation.date.date(),
                valid_till=quotation.valid_till.date(),
                cust_id=quotation.cust_id,
                customer_name=quotation.customer_name,
                customer_address=quotation.customer_address,
                status=quotation.status,
                product_ids=[item.product_id for item in line_items],
                product_names=[item.product_name for item in line_items],
                image_paths=[item.image_path for item in line_items],
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

    quotation.status = payload.status
    quotation.cust_id = payload.cust_id
    # Switching an existing quotation from a one-off buyer to a real client
    # (or back) has to clear the side it moved away from, or the stale
    # snapshot would keep overriding the client join in get_quotation_pdf.
    quotation.customer_name = payload.customer_name.strip() if payload.cust_id is None else ""
    quotation.customer_address = payload.customer_address.strip() if payload.cust_id is None else ""
    quotation.date = datetime.combine(payload.date, datetime.min.time())
    quotation.valid_till = datetime.combine(payload.valid_till, datetime.min.time())
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
        payload.product_names,
        payload.image_paths,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_totals_before_tax,
    )

    return UpdateQuotationDetailsResponse(message="quotation updated successfully")


@router.get("/get_quotation_pdf")
async def get_quotation_pdf(
    quotation_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    quotation = await QuotationDetails.get(quotation_id)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="quotation not found")

    # A one-off buyer (cust_id None) renders straight off the quotation's own
    # snapshot — there's no client row to join and no POC to read a phone off,
    # so phone/GSTIN come out empty and quotation.html drops both blocks
    # rather than printing a bare label.
    if quotation.cust_id is None:
        customer_name = quotation.customer_name
        customer_address = quotation.customer_address
        customer_phone = ""
        customer_gstin = ""
    else:
        customer = await CustomerDetails.get(quotation.cust_id)
        if customer is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

        pocs = await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).to_list()
        customer_name = customer.registered_name
        customer_address = customer.address
        customer_phone = pocs[0].contact_phone if pocs else ""
        customer_gstin = customer.company_gst

    summaries = await QuotationSummary.find(QuotationSummary.quotation_id == quotation.id).to_list()
    # One-off lines carry no product_id, so they sit out both joins below and
    # read their name/image off the summary row instead.
    product_ids = [summary.product_id for summary in summaries if summary.product_id is not None]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    # First image per product, same "one representative thumbnail" convention
    # as get_product_details — the quotation table shows a small thumbnail
    # next to each line item rather than every image on file.
    images = await ProductImageDetails.find(In(ProductImageDetails.product_id, product_ids)).to_list()
    first_image_by_product_id: dict[int, str] = {}
    for image in images:
        first_image_by_product_id.setdefault(image.product_id, image.image_path)

    def _to_line_item(summary: QuotationSummary) -> QuotationLineItem:
        product = products_by_id.get(summary.product_id) if summary.product_id is not None else None

        if summary.product_id is None:
            # One-off: the name and image live on the line itself, and there
            # is no listed price to compare the quoted rate against, so
            # unit_price falls back to the rate — which zeroes out the "% off"
            # column (see generate_quotation_pdf's discount_perc).
            product_name = summary.product_name
            image_path = summary.image_path
            unit_price = summary.rate
        elif product is None:
            # Catalogue line whose product row has since been hard-deleted.
            product_name = f"Product {summary.product_id}"
            image_path = None
            unit_price = summary.rate
        else:
            product_name = product.product_name
            image_path = first_image_by_product_id.get(summary.product_id)
            unit_price = product.actual_price

        return QuotationLineItem(
            product_name=product_name,
            image_path=image_path,
            unit_price=unit_price,
            rate=summary.rate,
            quantity=summary.quantity,
            tax_perc=summary.tax_perc,
            total=summary.total,
        )

    line_items = [_to_line_item(summary) for summary in summaries]

    personal = await get_personal_details()

    pdf_bytes = await generate_quotation_pdf(
        quotation_no=quotation.quotation_no,
        quotation_date=quotation.date,
        valid_till=quotation.valid_till,
        status=quotation.status.value,
        line_items=line_items,
        total_amount_after_tax=quotation.total_amount_after_tax,
        description=quotation.description,
        customer_name=customer_name,
        customer_address=customer_address,
        customer_phone=customer_phone,
        customer_gstin=customer_gstin,
        personal=personal,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="quotation-{quotation.quotation_no}.pdf"'},
    )
