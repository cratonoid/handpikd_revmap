# Invoices module: endpoints for raising standard sales invoices against
# existing sales orders, viewing/editing/voiding all sales invoices
# (standard + proforma), and generating their PDFs. Restricted to admins
# (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
#
# Proforma invoices are NOT created here — they're generated automatically
# by routes/quotations.py::update_quotation_details when a quotation
# transitions into "accepted", since a proforma is a mock invoice raised
# straight off a quotation rather than a real sales order. This module only
# lets admins view/edit/void/download the ones that exist.
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.routes.admin import require_admin
from app.models import (
    CustomerDetails,
    CustomerPocDetails,
    InvoiceDetails,
    InvoiceIdCounter,
    InvoiceType,
    ProductDetails,
    ProformaInvoiceNoCounterMaster,
    QuotationDetails,
    QuotationSummary,
    SalesOrders,
    SalesSummary,
    StandardInvoiceNoCounterMaster,
    User,
)
from app.schemas.invoices import (
    CreateNewInvoiceRequest,
    CreateNewInvoiceResponse,
    InvoiceDetailItem,
    UpdateInvoiceDetailsRequest,
    UpdateInvoiceDetailsResponse,
)
from app.services.counters import get_next_id
from app.services.invoice_numbering import format_sales_invoice_no
from app.services.invoice_pdf import InvoiceLineItem, generate_invoice_pdf
from app.services.personal_details import get_personal_details

router = APIRouter(prefix="/admin", tags=["invoices"])


async def _get_sales_order_or_404(sales_id: int) -> SalesOrders:
    sales_order = await SalesOrders.get(sales_id)
    if sales_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="sales order not found")
    return sales_order


async def _get_quotation_or_404(quotation_id: int) -> QuotationDetails:
    quotation = await QuotationDetails.get(quotation_id)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="quotation not found")
    return quotation


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


def _to_invoice_detail_item(invoice: InvoiceDetails) -> InvoiceDetailItem:
    return InvoiceDetailItem(
        id=invoice.id,
        invoice_no=invoice.invoice_no,
        invoice_no_display=format_sales_invoice_no(invoice.invoice_no, invoice.type),
        date=invoice.date,
        sales_id=invoice.sales_id,
        quotation_id=invoice.quotation_id,
        type=invoice.type,
        due_date=invoice.due_date,
        online_or_offline=invoice.online_or_offline,
        transport=invoice.transport,
        status=invoice.status,
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
    return [_to_invoice_detail_item(invoice) for invoice in invoices]


@router.post("/update_invoice_details", response_model=UpdateInvoiceDetailsResponse)
async def update_invoice_details(
    payload: UpdateInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateInvoiceDetailsResponse:
    invoice = await InvoiceDetails.get(payload.id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    # Re-snapshot totals from whatever this invoice is raised against, in
    # case it's changed since the invoice was created/generated — same
    # recompute-on-edit pattern as update_sales_order_details.
    if invoice.type == InvoiceType.standard:
        source = await _get_sales_order_or_404(invoice.sales_id)
    else:
        source = await _get_quotation_or_404(invoice.quotation_id)

    invoice.date = payload.date
    invoice.total_amount_before_tax = source.total_amount_before_tax
    invoice.total_tax_amount = source.total_tax_amount
    invoice.total_amount_after_tax = source.total_amount_after_tax
    invoice.due_date = payload.due_date
    invoice.online_or_offline = payload.online_or_offline
    invoice.transport = payload.transport
    invoice.status = payload.status
    invoice.is_deleted = payload.is_deleted
    await invoice.save()

    return UpdateInvoiceDetailsResponse(message="invoice updated successfully")


async def _build_invoice_pdf_inputs(summaries: list[SalesSummary] | list[QuotationSummary], cust_id: int):
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


@router.get("/get_invoice_pdf")
async def get_invoice_pdf(
    invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    invoice = await InvoiceDetails.get(invoice_id)
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    if invoice.type == InvoiceType.standard:
        sales_order = await _get_sales_order_or_404(invoice.sales_id)
        summaries = await SalesSummary.find(SalesSummary.sales_order_id == sales_order.id).to_list()
        cust_id = sales_order.cust_id
        title_text = "TAX INVOICE"
    else:
        quotation = await _get_quotation_or_404(invoice.quotation_id)
        summaries = await QuotationSummary.find(QuotationSummary.quotation_id == quotation.id).to_list()
        cust_id = quotation.cust_id
        title_text = "PROFORMA INVOICE"

    line_items, customer_name, customer_address, customer_phone, customer_gstin = (
        await _build_invoice_pdf_inputs(summaries, cust_id)
    )

    personal = await get_personal_details()
    invoice_no_display = format_sales_invoice_no(invoice.invoice_no, invoice.type)

    pdf_bytes = generate_invoice_pdf(
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
        title_text=title_text,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice-{invoice_no_display}.pdf"'},
    )
