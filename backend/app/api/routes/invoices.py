# Invoices module: endpoints for raising standard sales invoices against
# existing sales orders, raising proforma invoices by hand (own line items,
# no sales order/quotation involved — same "fill the form, generate a PDF"
# flow as quotations, see routes/quotations.py), viewing/editing/voiding
# both, and generating their PDFs. Restricted to admins (bypassed entirely
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
    ProformaInvoiceSummary,
    ProformaInvoiceSummaryIdCounter,
    SalesOrders,
    SalesSummary,
    StandardInvoiceNoCounterMaster,
    User,
)
from app.schemas.invoices import (
    CreateNewInvoiceRequest,
    CreateNewInvoiceResponse,
    CreateNewProformaInvoiceRequest,
    CreateNewProformaInvoiceResponse,
    InvoiceDetailItem,
    UpdateInvoiceDetailsRequest,
    UpdateInvoiceDetailsResponse,
    UpdateProformaInvoiceDetailsRequest,
    UpdateProformaInvoiceDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.invoice_numbering import format_sales_invoice_no
from app.services.invoice_pdf import InvoiceLineItem, generate_invoice_pdf
from app.services.personal_details import get_personal_details
from app.services.proforma_invoice_pdf import ProformaInvoiceLineItem, generate_proforma_invoice_pdf

router = APIRouter(prefix="/admin", tags=["invoices"])


async def _get_sales_order_or_404(sales_id: int) -> SalesOrders:
    sales_order = await SalesOrders.get(sales_id)
    if sales_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sales order not found")
    return sales_order


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


async def _insert_proforma_summary_rows(
    invoice_id: int,
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
        summary_id = await get_next_id(
            ProformaInvoiceSummaryIdCounter, "next_proforma_invoice_summary_id", ProformaInvoiceSummary
        )
        await ProformaInvoiceSummary(
            id=summary_id,
            invoice_id=invoice_id,
            product_id=product_id,
            quantity=quantity,
            rate=rate,
            tax_perc=tax_perc,
            tax_amount=tax_amount,
            total=line_total_before_tax + tax_amount,
        ).insert()


@router.post("/create_new_invoice", response_model=CreateNewInvoiceResponse)
async def create_new_invoice(
    payload: CreateNewInvoiceRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewInvoiceResponse:
    sales_order = await _get_sales_order_or_404(payload.sales_id)

    invoice_no = await get_next_id(StandardInvoiceNoCounterMaster, "next_invoice_no", InvoiceDetails)
    invoice_id = await get_next_id(InvoiceIdCounter, "next_invoice_id", InvoiceDetails)

    invoice = InvoiceDetails(
        id=invoice_id,
        invoice_no=invoice_no,
        date=payload.date,
        sales_id=payload.sales_id,
        quotation_id=None,
        total_amount_before_tax=sales_order.total_amount_before_tax,
        total_tax_amount=sales_order.total_tax_amount,
        total_amount_after_tax=sales_order.total_amount_after_tax,
        type=InvoiceType.standard,
        due_date=payload.due_date,
        online_or_offline=payload.online_or_offline,
        transport=payload.transport,
    )
    await invoice.insert()

    return CreateNewInvoiceResponse(message="invoice successfully created")


@router.post("/create_new_proforma_invoice", response_model=CreateNewProformaInvoiceResponse)
async def create_new_proforma_invoice(
    payload: CreateNewProformaInvoiceRequest,
    _: User | None = Depends(require_admin),
) -> CreateNewProformaInvoiceResponse:
    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

    invoice_no = await get_next_id(ProformaInvoiceNoCounterMaster, "next_invoice_no", InvoiceDetails)
    invoice_id = await get_next_id(InvoiceIdCounter, "next_invoice_id", InvoiceDetails)

    invoice = InvoiceDetails(
        id=invoice_id,
        invoice_no=invoice_no,
        date=payload.date,
        sales_id=None,
        quotation_id=None,
        cust_id=payload.cust_id,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        type=InvoiceType.proforma,
        due_date=payload.due_date,
        online_or_offline=OnlineOrOffline.offline,
        transport="",
        description=payload.description,
    )
    await invoice.insert()

    await _insert_proforma_summary_rows(
        invoice_id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_totals_before_tax,
    )

    # Same reasoning as create_new_quotation — the frontend's "Generate"
    # button needs the id immediately to chain straight into
    # GET /admin/get_invoice_pdf without a second round trip.
    return CreateNewProformaInvoiceResponse(
        message="proforma invoice successfully created",
        id=invoice_id,
        invoice_no_display=format_sales_invoice_no(invoice_no, InvoiceType.proforma),
    )


def _to_invoice_detail_item(
    invoice: InvoiceDetails, proforma_summaries: list[ProformaInvoiceSummary]
) -> InvoiceDetailItem:
    return InvoiceDetailItem(
        id=invoice.id,
        invoice_no=invoice.invoice_no,
        invoice_no_display=format_sales_invoice_no(invoice.invoice_no, invoice.type),
        date=invoice.date,
        sales_id=invoice.sales_id,
        quotation_id=invoice.quotation_id,
        cust_id=invoice.cust_id,
        type=invoice.type,
        due_date=invoice.due_date,
        online_or_offline=invoice.online_or_offline,
        transport=invoice.transport,
        status=invoice.status,
        product_ids=[item.product_id for item in proforma_summaries],
        quantities=[item.quantity for item in proforma_summaries],
        rates=[item.rate for item in proforma_summaries],
        tax_percs=[item.tax_perc for item in proforma_summaries],
        description=invoice.description,
        total_amount_before_tax=invoice.total_amount_before_tax,
        total_tax_amount=invoice.total_tax_amount,
        total_amount_after_tax=invoice.total_amount_after_tax,
        is_deleted=invoice.is_deleted,
    )


@router.get("/get_invoice_details", response_model=list[InvoiceDetailItem])
async def get_invoice_details(
    _: User | None = Depends(require_admin),
) -> list[InvoiceDetailItem]:
    invoices = await InvoiceDetails.find(InvoiceDetails.is_deleted == False).to_list()
    if not invoices:
        return []

    proforma_ids = [invoice.id for invoice in invoices if invoice.type == InvoiceType.proforma]
    summaries = (
        await ProformaInvoiceSummary.find(In(ProformaInvoiceSummary.invoice_id, proforma_ids)).to_list()
        if proforma_ids
        else []
    )
    summaries_by_invoice_id: dict[int, list[ProformaInvoiceSummary]] = {}
    for summary in summaries:
        summaries_by_invoice_id.setdefault(summary.invoice_id, []).append(summary)

    return [
        _to_invoice_detail_item(invoice, summaries_by_invoice_id.get(invoice.id, [])) for invoice in invoices
    ]


@router.post("/update_invoice_details", response_model=UpdateInvoiceDetailsResponse)
async def update_invoice_details(
    payload: UpdateInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateInvoiceDetailsResponse:
    invoice = await InvoiceDetails.get(payload.id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")
    if invoice.type != InvoiceType.standard:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="use update_proforma_invoice_details for proforma invoices",
        )

    # Re-snapshot totals from the linked sales order, in case it's changed
    # since the invoice was created/generated — same recompute-on-edit
    # pattern as update_sales_order_details.
    sales_order = await _get_sales_order_or_404(invoice.sales_id)

    invoice.date = payload.date
    invoice.total_amount_before_tax = sales_order.total_amount_before_tax
    invoice.total_tax_amount = sales_order.total_tax_amount
    invoice.total_amount_after_tax = sales_order.total_amount_after_tax
    invoice.due_date = payload.due_date
    invoice.online_or_offline = payload.online_or_offline
    invoice.transport = payload.transport
    invoice.status = payload.status
    invoice.is_deleted = payload.is_deleted
    await invoice.save()

    return UpdateInvoiceDetailsResponse(message="invoice updated successfully")


@router.post("/update_proforma_invoice_details", response_model=UpdateProformaInvoiceDetailsResponse)
async def update_proforma_invoice_details(
    payload: UpdateProformaInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateProformaInvoiceDetailsResponse:
    invoice = await InvoiceDetails.get(payload.id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")
    if invoice.type != InvoiceType.proforma:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="use update_invoice_details for standard invoices",
        )

    await _validate_customer_exists(payload.cust_id)
    await _validate_products_exist(payload.product_ids)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )

    invoice.cust_id = payload.cust_id
    invoice.date = payload.date
    invoice.due_date = payload.due_date
    invoice.total_amount_before_tax = total_before_tax
    invoice.total_tax_amount = total_tax
    invoice.total_amount_after_tax = total_after_tax
    invoice.description = payload.description
    invoice.is_deleted = payload.is_deleted
    await invoice.save()

    await ProformaInvoiceSummary.find(ProformaInvoiceSummary.invoice_id == invoice.id).delete()
    await _insert_proforma_summary_rows(
        invoice.id,
        payload.product_ids,
        payload.quantities,
        payload.rates,
        payload.tax_percs,
        tax_amounts,
        line_totals_before_tax,
    )

    return UpdateProformaInvoiceDetailsResponse(message="proforma invoice updated successfully")


async def _build_standard_invoice_pdf_inputs(summaries: list[SalesSummary], cust_id: int):
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    pocs = await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).to_list()
    customer_phone = pocs[0].contact_phone if pocs else ""

    product_ids = [summary.product_id for summary in summaries]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    line_items = [
        InvoiceLineItem(
            product_name=products_by_id[summary.product_id].product_name
            if summary.product_id in products_by_id
            else f"Product {summary.product_id}",
            hsn_code=products_by_id[summary.product_id].hsn_code if summary.product_id in products_by_id else "",
            quantity=summary.quantity,
            rate=summary.rate,
            taxable_value=summary.quantity * summary.rate,
            tax_perc=summary.tax_perc,
            tax_amount=summary.tax_amount,
            total=summary.total,
        )
        for summary in summaries
    ]

    return line_items, customer.registered_name, customer.address, customer_phone, customer.company_gst


async def _build_proforma_invoice_pdf_inputs(summaries: list[ProformaInvoiceSummary], cust_id: int | None):
    customer = await CustomerDetails.get(cust_id) if cust_id is not None else None
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    pocs = await CustomerPocDetails.find(CustomerPocDetails.customer_id == customer.id).to_list()
    customer_phone = pocs[0].contact_phone if pocs else ""

    product_ids = [summary.product_id for summary in summaries]
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}

    # First image per product, same "one representative thumbnail" convention
    # as get_quotation_pdf.
    images = await ProductImageDetails.find(In(ProductImageDetails.product_id, product_ids)).to_list()
    first_image_by_product_id: dict[int, str] = {}
    for image in images:
        first_image_by_product_id.setdefault(image.product_id, image.image_path)

    line_items = [
        ProformaInvoiceLineItem(
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

    return line_items, customer.registered_name, customer.address, customer_phone, customer.company_gst


@router.get("/get_invoice_pdf")
async def get_invoice_pdf(
    invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    invoice = await InvoiceDetails.get(invoice_id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    invoice_no_display = format_sales_invoice_no(invoice.invoice_no, invoice.type)
    personal = await get_personal_details()

    if invoice.type == InvoiceType.standard:
        sales_order = await _get_sales_order_or_404(invoice.sales_id)
        summaries = await SalesSummary.find(SalesSummary.sales_order_id == sales_order.id).to_list()
        line_items, customer_name, customer_address, customer_phone, customer_gstin = (
            await _build_standard_invoice_pdf_inputs(summaries, sales_order.cust_id)
        )

        pdf_bytes = await generate_invoice_pdf(
            invoice_no=invoice_no_display,
            invoice_date=invoice.date,
            due_date=invoice.due_date,
            transport=invoice.transport,
            line_items=line_items,
            total_amount_before_tax=invoice.total_amount_before_tax,
            total_tax_amount=invoice.total_tax_amount,
            total_amount_after_tax=invoice.total_amount_after_tax,
            customer_name=customer_name,
            customer_address=customer_address,
            customer_phone=customer_phone,
            customer_gstin=customer_gstin,
            personal=personal,
            title_text="TAX INVOICE",
            show_signature=invoice.online_or_offline == OnlineOrOffline.offline,
        )
        filename = f"invoice-{invoice_no_display}.pdf"
    else:
        summaries = await ProformaInvoiceSummary.find(ProformaInvoiceSummary.invoice_id == invoice.id).to_list()
        line_items, customer_name, customer_address, customer_phone, customer_gstin = (
            await _build_proforma_invoice_pdf_inputs(summaries, invoice.cust_id)
        )

        pdf_bytes = await generate_proforma_invoice_pdf(
            invoice_no_display=invoice_no_display,
            invoice_date=invoice.date,
            due_date=invoice.due_date,
            line_items=line_items,
            total_amount_after_tax=invoice.total_amount_after_tax,
            description=invoice.description,
            customer_name=customer_name,
            customer_address=customer_address,
            customer_phone=customer_phone,
            customer_gstin=customer_gstin,
            personal=personal,
        )
        filename = f"proforma-invoice-{invoice_no_display}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
