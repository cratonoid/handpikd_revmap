# Invoices module: endpoints for raising standard sales invoices against
# existing sales orders, raising proforma invoices by hand (own line items,
# no sales order/quotation involved — same "fill the form, generate a PDF"
# flow as quotations, see routes/quotations.py), viewing/editing/voiding
# both, and generating their PDFs. Restricted to admins (bypassed entirely
# when settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
import io
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, time

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
from app.services.gst import TaxKind, resolve_state_code, split_tax, state_name_for_code, tax_kind_for
from app.services.invoice_numbering import format_sales_invoice_no
from app.services.invoice_pdf import InvoiceLineItem, generate_invoice_pdf
from app.services.personal_details import get_personal_details
from app.services.proforma_invoice_pdf import ProformaInvoiceLineItem, generate_proforma_invoice_pdf

router = APIRouter(prefix="/admin", tags=["invoices"])


async def _get_sales_orders_or_404(sales_ids: list[int]) -> list[SalesOrders]:
    sales_orders = await SalesOrders.find(In(SalesOrders.id, sales_ids)).to_list()
    orders_by_id = {order.id: order for order in sales_orders}
    missing = [sales_id for sales_id in sales_ids if sales_id not in orders_by_id]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"sales order(s) not found: {missing}"
        )
    # Preserve the caller-supplied order for deterministic totals/line-item ordering.
    return [orders_by_id[sales_id] for sales_id in sales_ids]


def _sum_sales_order_totals(sales_orders: list[SalesOrders]) -> tuple[float, float, float]:
    total_before_tax = sum(order.total_amount_before_tax for order in sales_orders)
    total_tax = sum(order.total_tax_amount for order in sales_orders)
    total_after_tax = sum(order.total_amount_after_tax for order in sales_orders)
    return total_before_tax, total_tax, total_after_tax


def _check_same_customer(sales_orders: list[SalesOrders]) -> None:
    # An invoice shows one customer name/address on its PDF, so every linked
    # sales order must belong to the same customer.
    if len({order.cust_id for order in sales_orders}) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="all selected sales orders must belong to the same customer",
        )


async def _validate_customer_exists(cust_id: int) -> None:
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")


async def _validate_products_exist(product_ids: list[int], reject_deleted: bool = False) -> None:
    # reject_deleted is on for creates only. A soft-deleted product must not
    # be pickable on something new (it isn't offered by the frontend's picker
    # either — see the isDeleted filter in the form modals), but an existing
    # document that already lists one still has to be editable, so updates
    # only check that the product exists at all.
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    products_by_id = {product.id: product for product in products}
    for product_id in product_ids:
        if product_id not in products_by_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"product {product_id} not found")
        if reject_deleted and products_by_id[product_id].is_deleted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"product {product_id} has been deleted"
            )


@dataclass
class _TaxContext:
    """The GST facts an invoice freezes at the moment it's raised."""

    kind: TaxKind
    place_of_supply_code: str
    place_of_supply_name: str

    def totals(self, total_tax_amount: float) -> tuple[float, float, float]:
        """`total_tax_amount` split into (igst, cgst, sgst)."""
        split = split_tax(0.0, total_tax_amount, self.kind)
        return split.igst_amount, split.cgst_amount, split.sgst_amount


async def _tax_context_for_customer(cust_id: int) -> _TaxContext:
    """Decides IGST vs CGST+SGST for a sale to `cust_id`.

    Compares the client's state against our own (the profile's state_code),
    both of which fall back to their party's GSTIN prefix for records
    predating the state field. A client with no GSTIN but a state on file is
    handled correctly here: a same-state supply to an unregistered buyer is
    still CGST+SGST.
    """
    customer = await CustomerDetails.get(cust_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="customer not found")

    personal = await get_personal_details()
    buyer_state = resolve_state_code(customer.state_code, customer.company_gst)
    seller_state = resolve_state_code(personal.get("state_code"), personal.get("gstin"))

    return _TaxContext(
        kind=tax_kind_for(buyer_state, seller_state),
        place_of_supply_code=buyer_state or "",
        place_of_supply_name=state_name_for_code(buyer_state) or "",
    )


def _apply_tax_context(invoice: InvoiceDetails, context: _TaxContext, total_tax: float) -> None:
    igst, cgst, sgst = context.totals(total_tax)
    invoice.tax_kind = context.kind
    invoice.place_of_supply_code = context.place_of_supply_code
    invoice.place_of_supply_name = context.place_of_supply_name
    invoice.total_igst_amount = igst
    invoice.total_cgst_amount = cgst
    invoice.total_sgst_amount = sgst


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
    sales_orders = await _get_sales_orders_or_404(payload.sales_ids)
    _check_same_customer(sales_orders)
    total_before_tax, total_tax, total_after_tax = _sum_sales_order_totals(sales_orders)
    # All linked sales orders share one customer (just enforced above).
    tax_context = await _tax_context_for_customer(sales_orders[0].cust_id)
    total_igst, total_cgst, total_sgst = tax_context.totals(total_tax)

    invoice_no = await get_next_id(StandardInvoiceNoCounterMaster, "next_invoice_no", InvoiceDetails)
    invoice_id = await get_next_id(InvoiceIdCounter, "next_invoice_id", InvoiceDetails)

    invoice = InvoiceDetails(
        id=invoice_id,
        invoice_no=invoice_no,
        date=payload.date,
        sales_ids=payload.sales_ids,
        quotation_id=None,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        tax_kind=tax_context.kind,
        place_of_supply_code=tax_context.place_of_supply_code,
        place_of_supply_name=tax_context.place_of_supply_name,
        total_igst_amount=total_igst,
        total_cgst_amount=total_cgst,
        total_sgst_amount=total_sgst,
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
    await _validate_products_exist(payload.product_ids, reject_deleted=True)

    line_totals_before_tax, tax_amounts, total_before_tax, total_tax, total_after_tax = (
        _compute_line_items_and_totals(payload.quantities, payload.rates, payload.tax_percs)
    )
    tax_context = await _tax_context_for_customer(payload.cust_id)
    total_igst, total_cgst, total_sgst = tax_context.totals(total_tax)

    invoice_no = await get_next_id(ProformaInvoiceNoCounterMaster, "next_invoice_no", InvoiceDetails)
    invoice_id = await get_next_id(InvoiceIdCounter, "next_invoice_id", InvoiceDetails)

    invoice = InvoiceDetails(
        id=invoice_id,
        invoice_no=invoice_no,
        date=payload.date,
        quotation_id=None,
        cust_id=payload.cust_id,
        total_amount_before_tax=total_before_tax,
        total_tax_amount=total_tax,
        total_amount_after_tax=total_after_tax,
        tax_kind=tax_context.kind,
        place_of_supply_code=tax_context.place_of_supply_code,
        place_of_supply_name=tax_context.place_of_supply_name,
        total_igst_amount=total_igst,
        total_cgst_amount=total_cgst,
        total_sgst_amount=total_sgst,
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
        sales_ids=invoice.sales_ids,
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

    # Re-snapshot totals from the linked sales orders, in case any have
    # changed since the invoice was created/generated — same recompute-on-edit
    # pattern as update_sales_order_details.
    sales_orders = await _get_sales_orders_or_404(invoice.sales_ids)
    total_before_tax, total_tax, total_after_tax = _sum_sales_order_totals(sales_orders)

    invoice.date = payload.date
    invoice.total_amount_before_tax = total_before_tax
    invoice.total_tax_amount = total_tax
    invoice.total_amount_after_tax = total_after_tax
    # Re-decided alongside the totals: an edit is the point at which the
    # admin has reviewed the invoice, so a client whose state was corrected
    # in the meantime should take effect here rather than on the next
    # reprint.
    _apply_tax_context(invoice, await _tax_context_for_customer(sales_orders[0].cust_id), total_tax)
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
    _apply_tax_context(invoice, await _tax_context_for_customer(payload.cust_id), total_tax)
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


def _line_discount_and_taxable_value(summary: SalesSummary) -> dict[str, float]:
    # #sales_summary stores the GROSS rate but a NET total: the costing
    # sheet's per-product discount and the order's overall discount are both
    # taken off the line subtotal before tax is charged, and only the result
    # is kept (see _compute_line_items_and_totals in routes/sales_orders.py).
    # So the discount has to be read back out of the gap between the two, or
    # the invoice prints a quantity x rate that doesn't reconcile with its own
    # Total row — which is exactly what it used to do.
    taxable_value = round(summary.total - summary.tax_amount, 2)
    # max() guards the float noise on an undiscounted line, which would
    # otherwise print "-0.00".
    return {
        "discount": max(round(summary.quantity * summary.rate - taxable_value, 2), 0.0),
        "taxable_value": taxable_value,
    }


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
            **_line_discount_and_taxable_value(summary),
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


async def _generate_standard_invoice_pdf(invoice: InvoiceDetails, personal: dict[str, str]) -> tuple[bytes, str]:
    invoice_no_display = format_sales_invoice_no(invoice.invoice_no, invoice.type)
    sales_orders = await _get_sales_orders_or_404(invoice.sales_ids)
    # All linked sales orders share one customer (enforced in
    # create_new_invoice), so any of them gives the right cust_id.
    cust_id = sales_orders[0].cust_id
    summaries = await SalesSummary.find(
        In(SalesSummary.sales_order_id, invoice.sales_ids)
    ).to_list()
    line_items, customer_name, customer_address, customer_phone, customer_gstin = (
        await _build_standard_invoice_pdf_inputs(summaries, cust_id)
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
        # The heads this invoice was raised under, not whatever the two
        # GSTINs say today (None for pre-tax_kind invoices, which the
        # renderer still derives from the GSTINs).
        tax_kind=invoice.tax_kind,
        place_of_supply_code=invoice.place_of_supply_code,
    )
    filename = f"invoice-{invoice_no_display}.pdf"
    return pdf_bytes, filename


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
        pdf_bytes, filename = await _generate_standard_invoice_pdf(invoice, personal)
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


@router.get("/get_invoices_pdf_zip")
async def get_invoices_pdf_zip(
    start_date: date,
    end_date: date,
    _: User | None = Depends(require_admin),
) -> Response:
    # Standard invoices only, bounded by invoice date (not due date) —
    # bulk download is a "give me everything I raised this month" tool,
    # not something proforma invoices need yet.
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    invoices = await InvoiceDetails.find(
        InvoiceDetails.type == InvoiceType.standard,
        InvoiceDetails.is_deleted == False,
        InvoiceDetails.date >= start_dt,
        InvoiceDetails.date <= end_dt,
    ).to_list()

    if not invoices:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no invoices found in that date range")

    personal = await get_personal_details()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for invoice in invoices:
            pdf_bytes, filename = await _generate_standard_invoice_pdf(invoice, personal)
            archive.writestr(filename, pdf_bytes)

    zip_filename = f"invoices-{start_date.isoformat()}-to-{end_date.isoformat()}.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
