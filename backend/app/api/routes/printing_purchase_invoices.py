# Printing purchase invoices module: endpoints for viewing, editing and
# voiding a printing purchase invoice, and for attaching (or replacing) the
# vendor's own PDF. Restricted to admins (bypassed entirely when
# settings.auth_enabled is False, matching require_admin in
# routes/admin.py).
#
# The printing counterpart of routes/purchase_invoices.py, with two
# deliberate differences:
#   - There is no branded-PDF endpoint. A printing purchase invoice is a
#     record of the VENDOR's document, so the uploaded original is the only
#     PDF it has and the only one served.
#   - Nothing here can touch inventory, because nothing on the printing side
#     ever does — see routes/printing_orders.py's docstring.
#
# As on the material side, nothing here CREATES a printing purchase invoice:
# every one is raised as part of creating the printing purchase order it
# belongs to (see create_new_printing_purchase_order and
# services/printing_purchase_invoices.py). The vendor's PDF is attached
# afterwards as its own request — the same two-phase pattern the rest of the
# app uses to keep a file out of a JSON request — and that endpoint doubles
# as "replace", hard-deleting the old file once the new one is saved.
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import PrintingPurchaseInvoiceDetails, User
from app.schemas.printing_purchase_invoices import (
    AttachPrintingPurchaseInvoicePdfResponse,
    PrintingPurchaseInvoiceDetailItem,
    UpdatePrintingPurchaseInvoiceDetailsRequest,
    UpdatePrintingPurchaseInvoiceDetailsResponse,
)
from app.services.invoice_numbering import format_printing_purchase_invoice_no
from app.services.purchase_invoice_storage import delete_uploaded_pdf, read_uploaded_pdf, save_uploaded_pdf
from app.services.storage import LocalUploadBlockedError

router = APIRouter(prefix="/admin", tags=["printing-purchase-invoices"])


async def _get_printing_purchase_invoice_or_404(
    printing_purchase_invoice_id: int,
) -> PrintingPurchaseInvoiceDetails:
    printing_purchase_invoice = await PrintingPurchaseInvoiceDetails.get(printing_purchase_invoice_id)
    if printing_purchase_invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="printing purchase invoice not found"
        )
    return printing_purchase_invoice


@router.post(
    "/attach_printing_purchase_invoice_pdf", response_model=AttachPrintingPurchaseInvoicePdfResponse
)
async def attach_printing_purchase_invoice_pdf(
    printing_purchase_invoice_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AttachPrintingPurchaseInvoicePdfResponse:
    printing_purchase_invoice = await _get_printing_purchase_invoice_or_404(printing_purchase_invoice_id)

    # Captured before overwriting below — if this invoice already has an
    # uploaded PDF, this call replaces it: the old file is only removed once
    # the new one is safely saved and the record points at it, so a failure
    # partway through never loses the previous PDF.
    previous_pdf_path = printing_purchase_invoice.uploaded_pdf_path

    pdf_bytes = await file.read()
    try:
        printing_purchase_invoice.uploaded_pdf_path = save_uploaded_pdf(pdf_bytes)
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    await printing_purchase_invoice.save()

    if previous_pdf_path is not None:
        delete_uploaded_pdf(previous_pdf_path)

    return AttachPrintingPurchaseInvoicePdfResponse(message="PDF attached successfully")


def _to_detail_item(
    printing_purchase_invoice: PrintingPurchaseInvoiceDetails,
) -> PrintingPurchaseInvoiceDetailItem:
    return PrintingPurchaseInvoiceDetailItem(
        id=printing_purchase_invoice.id,
        printing_purchase_invoice_no=printing_purchase_invoice.printing_purchase_invoice_no,
        printing_purchase_invoice_no_display=format_printing_purchase_invoice_no(
            printing_purchase_invoice.printing_purchase_invoice_no
        ),
        date=printing_purchase_invoice.date,
        vendor_id=printing_purchase_invoice.vendor_id,
        po_id=printing_purchase_invoice.po_id,
        vendor_invoice_no=printing_purchase_invoice.vendor_invoice_no,
        has_uploaded_pdf=printing_purchase_invoice.uploaded_pdf_path is not None,
        total_amount_before_tax=printing_purchase_invoice.total_amount_before_tax,
        total_tax_amount=printing_purchase_invoice.total_tax_amount,
        total_amount_after_tax=printing_purchase_invoice.total_amount_after_tax,
        is_deleted=printing_purchase_invoice.is_deleted,
    )


@router.get(
    "/get_printing_purchase_invoice_details", response_model=list[PrintingPurchaseInvoiceDetailItem]
)
async def get_printing_purchase_invoice_details(
    _: User | None = Depends(require_admin),
) -> list[PrintingPurchaseInvoiceDetailItem]:
    printing_purchase_invoices = await PrintingPurchaseInvoiceDetails.find(
        PrintingPurchaseInvoiceDetails.is_deleted == False  # noqa: E712 — Beanie needs the comparison
    ).to_list()
    return [_to_detail_item(invoice) for invoice in printing_purchase_invoices]


@router.post(
    "/update_printing_purchase_invoice_details",
    response_model=UpdatePrintingPurchaseInvoiceDetailsResponse,
)
async def update_printing_purchase_invoice_details(
    payload: UpdatePrintingPurchaseInvoiceDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdatePrintingPurchaseInvoiceDetailsResponse:
    printing_purchase_invoice = await _get_printing_purchase_invoice_or_404(payload.id)

    printing_purchase_invoice.date = payload.date
    printing_purchase_invoice.is_deleted = payload.is_deleted
    await printing_purchase_invoice.save()

    return UpdatePrintingPurchaseInvoiceDetailsResponse(
        message="printing purchase invoice updated successfully"
    )


@router.get("/get_printing_purchase_invoice_uploaded_pdf")
async def get_printing_purchase_invoice_uploaded_pdf(
    printing_purchase_invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    printing_purchase_invoice = await _get_printing_purchase_invoice_or_404(printing_purchase_invoice_id)
    if printing_purchase_invoice.uploaded_pdf_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no uploaded PDF for this printing purchase invoice",
        )

    pdf_bytes = read_uploaded_pdf(printing_purchase_invoice.uploaded_pdf_path)
    if pdf_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="uploaded PDF file is missing")

    display_no = format_printing_purchase_invoice_no(
        printing_purchase_invoice.printing_purchase_invoice_no
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{display_no}.pdf"'},
    )
