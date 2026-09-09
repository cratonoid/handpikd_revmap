# Client portal: the invoice screens a signed-in customer sees for their own
# account — the list, one invoice's line items and GST split, and the PDF.
#
# Everything here is scoped to the CustomerDetails row behind the signed-in
# User (require_customer_account below). That scoping is the whole point of
# the module, which is why these routes authenticate for real even when
# settings.auth_enabled is off (see get_authenticated_user in api/deps.py):
# an unidentified caller here would either see every client's invoices or
# none, and neither is a sensible development default.
#
# The invoices themselves are read-only from this side. Raising, editing and
# voiding stay entirely in routes/invoices.py, and the PDF a client downloads
# is produced by that module's build_invoice_pdf — the same bytes the admin
# gets, not a second rendering of the same data.
from beanie.operators import In, Or
from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import get_authenticated_user
from app.api.routes.invoices import (
    build_invoice_pdf,
    line_discount_and_taxable_value,
    pdf_response,
    resolve_invoice_customer_id,
)
from app.models import (
    CustomerDetails,
    InvoiceDetails,
    InvoiceType,
    ProductDetails,
    ProformaInvoiceSummary,
    SalesOrders,
    SalesSummary,
    User,
    UserRole,
)
from app.schemas.customer_invoices import (
    CustomerInvoiceDetail,
    CustomerInvoiceLineItem,
    CustomerInvoiceListItem,
)
from app.services.invoice_numbering import format_sales_invoice_no

router = APIRouter(prefix="/customer", tags=["customer-invoices"])


async def require_customer_account(
    current_user: User = Depends(get_authenticated_user),
) -> CustomerDetails:
    """The CustomerDetails row the signed-in user is allowed to act as.

    Admins are rejected rather than silently allowed through: they have no
    CustomerDetails row of their own, and the admin screens already show
    every invoice. A soft-deleted client is rejected too — closing an
    account has to actually close it.
    """
    if current_user.role != UserRole.customer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="client account required")

    customer = await CustomerDetails.find_one(CustomerDetails.user_id == current_user.id)
    if customer is None or customer.is_deleted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="no client profile for this login")

    return customer


async def _owned_invoices(customer: CustomerDetails) -> list[InvoiceDetails]:
    """Every live invoice billed to `customer`, newest first.

    Two ways in, because the two invoice types record their client
    differently (see InvoiceDetails): a proforma invoice names it directly in
    cust_id, while a standard one only names the sales orders it was raised
    against. `sales_ids` is an array, so the $in here matches an invoice
    whose array contains any of this client's orders.

    Voided invoices (is_deleted) are left out — from the client's side an
    invoice that was withdrawn simply isn't one.
    """
    orders = await SalesOrders.find(SalesOrders.cust_id == customer.id).to_list()
    sales_order_ids = [order.id for order in orders]

    owned = [InvoiceDetails.cust_id == customer.id]
    if sales_order_ids:
        owned.append(In(InvoiceDetails.sales_ids, sales_order_ids))

    return (
        await InvoiceDetails.find(InvoiceDetails.is_deleted == False, Or(*owned))
        .sort(-InvoiceDetails.date, -InvoiceDetails.id)
        .to_list()
    )


async def _get_owned_invoice_or_404(invoice_id: int, customer: CustomerDetails) -> InvoiceDetails:
    invoice = await InvoiceDetails.get(invoice_id)
    # 404 rather than 403 on someone else's invoice, deliberately: a client
    # walking ids must not be able to tell "not yours" apart from "no such
    # invoice", which would leak how many invoices exist and for whom.
    if invoice is None or invoice.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    if await resolve_invoice_customer_id(invoice) != customer.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    return invoice


def _to_list_item(invoice: InvoiceDetails, sales_order_nos: list[int]) -> CustomerInvoiceListItem:
    return CustomerInvoiceListItem(
        id=invoice.id,
        invoice_no_display=format_sales_invoice_no(invoice),
        date=invoice.date,
        due_date=invoice.due_date,
        type=invoice.type,
        status=invoice.status,
        sales_order_nos=sales_order_nos,
        total_amount_before_tax=invoice.total_amount_before_tax,
        total_tax_amount=invoice.total_tax_amount,
        total_amount_after_tax=invoice.total_amount_after_tax,
    )


async def _order_nos_by_id(sales_ids: list[int]) -> dict[int, int]:
    if not sales_ids:
        return {}

    orders = await SalesOrders.find(In(SalesOrders.id, sales_ids)).to_list()
    return {order.id: order.order_no for order in orders}


def _order_nos_for(invoice: InvoiceDetails, order_no_by_id: dict[int, int]) -> list[int]:
    # Keeps the invoice's own ordering, and skips an id whose order has since
    # been hard-deleted rather than failing the whole listing over it.
    return [order_no_by_id[sales_id] for sales_id in invoice.sales_ids if sales_id in order_no_by_id]


async def _products_by_id(product_ids: list[int]) -> dict[int, ProductDetails]:
    products = await ProductDetails.find(In(ProductDetails.id, product_ids)).to_list()
    return {product.id: product for product in products}


def _product_name(products_by_id: dict[int, ProductDetails], product_id: int) -> str:
    # Same fallback the PDF renderers use — a since-hard-deleted product
    # leaves the line readable rather than blanking it.
    product = products_by_id.get(product_id)
    return product.product_name if product is not None else f"Product {product_id}"


def _hsn_code(products_by_id: dict[int, ProductDetails], product_id: int) -> str:
    product = products_by_id.get(product_id)
    return product.hsn_code if product is not None else ""


async def _standard_line_items(invoice: InvoiceDetails) -> list[CustomerInvoiceLineItem]:
    summaries = await SalesSummary.find(In(SalesSummary.sales_order_id, invoice.sales_ids)).to_list()
    products_by_id = await _products_by_id([summary.product_id for summary in summaries])

    return [
        CustomerInvoiceLineItem(
            product_name=_product_name(products_by_id, summary.product_id),
            hsn_code=_hsn_code(products_by_id, summary.product_id),
            quantity=summary.quantity,
            rate=summary.rate,
            **line_discount_and_taxable_value(summary),
            tax_perc=summary.tax_perc,
            tax_amount=summary.tax_amount,
            total=summary.total,
        )
        for summary in summaries
    ]


async def _proforma_line_items(invoice: InvoiceDetails) -> list[CustomerInvoiceLineItem]:
    summaries = await ProformaInvoiceSummary.find(
        ProformaInvoiceSummary.invoice_id == invoice.id
    ).to_list()
    products_by_id = await _products_by_id([summary.product_id for summary in summaries])

    return [
        CustomerInvoiceLineItem(
            product_name=_product_name(products_by_id, summary.product_id),
            hsn_code=_hsn_code(products_by_id, summary.product_id),
            quantity=summary.quantity,
            rate=summary.rate,
            # A proforma line carries no discount at all: its `total` is
            # quantity x rate plus tax, straight from the figures the admin
            # keyed in (see _insert_proforma_summary_rows in
            # routes/invoices.py). So the taxable value is just the product of
            # the two — there is nothing to read back out of the gap the way a
            # #sales_summary row needs.
            discount=0.0,
            taxable_value=round(summary.quantity * summary.rate, 2),
            tax_perc=summary.tax_perc,
            tax_amount=summary.tax_amount,
            total=summary.total,
        )
        for summary in summaries
    ]


@router.get("/get_my_invoices", response_model=list[CustomerInvoiceListItem])
async def get_my_invoices(
    customer: CustomerDetails = Depends(require_customer_account),
) -> list[CustomerInvoiceListItem]:
    invoices = await _owned_invoices(customer)
    if not invoices:
        return []

    # One lookup for every standard invoice's order numbers, rather than one
    # round trip per invoice.
    all_sales_ids = sorted({sales_id for invoice in invoices for sales_id in invoice.sales_ids})
    order_no_by_id = await _order_nos_by_id(all_sales_ids)

    return [_to_list_item(invoice, _order_nos_for(invoice, order_no_by_id)) for invoice in invoices]


@router.get("/get_my_invoice_details", response_model=CustomerInvoiceDetail)
async def get_my_invoice_details(
    invoice_id: int,
    customer: CustomerDetails = Depends(require_customer_account),
) -> CustomerInvoiceDetail:
    invoice = await _get_owned_invoice_or_404(invoice_id, customer)

    line_items = (
        await _standard_line_items(invoice)
        if invoice.type == InvoiceType.standard
        else await _proforma_line_items(invoice)
    )

    base = _to_list_item(invoice, _order_nos_for(invoice, await _order_nos_by_id(invoice.sales_ids)))
    return CustomerInvoiceDetail(
        **base.model_dump(),
        transport=invoice.transport,
        description=invoice.description,
        line_items=line_items,
        tax_kind=invoice.tax_kind,
        place_of_supply_code=invoice.place_of_supply_code,
        place_of_supply_name=invoice.place_of_supply_name,
        total_igst_amount=invoice.total_igst_amount,
        total_cgst_amount=invoice.total_cgst_amount,
        total_sgst_amount=invoice.total_sgst_amount,
        billed_to_name=customer.registered_name,
        billed_to_address=customer.address,
        billed_to_gstin=customer.company_gst,
    )


@router.get("/get_my_invoice_pdf")
async def get_my_invoice_pdf(
    invoice_id: int,
    customer: CustomerDetails = Depends(require_customer_account),
) -> Response:
    invoice = await _get_owned_invoice_or_404(invoice_id, customer)
    pdf_bytes, filename = await build_invoice_pdf(invoice)
    return pdf_response(pdf_bytes, filename)
