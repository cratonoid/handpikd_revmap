# Purchase invoices module: endpoints for viewing/editing/voiding a purchase
# invoice, and for attaching (or replacing) the vendor's own PDF. Purely a
# billing record: unlike create_new_purchase_order, nothing here touches
# inventory (see services/inventory.py::record_purchase_received) — that
# stays exclusively on the purchase-order-received flow. Restricted to admins
# (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
#
# There is deliberately no branded PDF here. A purchase invoice is a record
# of what a VENDOR billed us, so their own document is the authoritative one
# and the only one worth serving: rendering our own version of someone else's
# invoice produced a second document stating the same charge in our
# letterhead, which is not a thing we issue and not a thing anyone should
# file. get_purchase_invoice_uploaded_pdf is therefore the only PDF endpoint,
# and services/purchase_invoice_pdf.py is gone rather than left unused. Sales
# invoices still render (routes/invoices.py) — those are documents we
# genuinely issue.
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
import io
import zipfile
from datetime import date, datetime, time

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import PurchaseInvoiceDetails, User
from app.schemas.purchase_invoices import (
    AttachPurchaseInvoicePdfResponse,
    PurchaseInvoiceDetailItem,
    UpdatePurchaseInvoiceDetailsRequest,
    UpdatePurchaseInvoiceDetailsResponse,
)
from app.services.invoice_numbering import format_purchase_invoice_no
from app.services.purchase_invoice_storage import delete_uploaded_pdf, read_uploaded_pdf, save_uploaded_pdf
from app.services.storage import LocalUploadBlockedError

router = APIRouter(prefix="/admin", tags=["purchase-invoices"])


async def _get_purchase_invoice_or_404(purchase_invoice_id: int) -> PurchaseInvoiceDetails:
    purchase_invoice = await PurchaseInvoiceDetails.get(purchase_invoice_id)
    if purchase_invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="purchase invoice not found")
    return purchase_invoice


@router.post("/attach_purchase_invoice_pdf", response_model=AttachPurchaseInvoicePdfResponse)
async def attach_purchase_invoice_pdf(
    purchase_invoice_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AttachPurchaseInvoicePdfResponse:
    purchase_invoice = await _get_purchase_invoice_or_404(purchase_invoice_id)

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
    purchase_invoice = await _get_purchase_invoice_or_404(payload.id)

    purchase_invoice.date = payload.date
    purchase_invoice.is_deleted = payload.is_deleted
    await purchase_invoice.save()

    return UpdatePurchaseInvoiceDetailsResponse(message="purchase invoice updated successfully")


@router.get("/get_purchase_invoice_uploaded_pdf")
async def get_purchase_invoice_uploaded_pdf(
    purchase_invoice_id: int,
    _: User | None = Depends(require_admin),
) -> Response:
    purchase_invoice = await _get_purchase_invoice_or_404(purchase_invoice_id)
    if purchase_invoice.uploaded_pdf_path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no uploaded PDF for this purchase invoice")

    pdf_bytes = read_uploaded_pdf(purchase_invoice.uploaded_pdf_path)
    if pdf_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="uploaded PDF file is missing")

    # Named after our own record rather than the vendor's file, so a folder
    # of downloads sorts and reads the way the invoices list does. It used to
    # carry an "-original" suffix, back when there was a generated PDF for it
    # to be distinguished from.
    display_no = format_purchase_invoice_no(purchase_invoice.purchase_invoice_no)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{display_no}.pdf"'},
    )


@router.get("/get_purchase_invoices_pdf_zip")
async def get_purchase_invoices_pdf_zip(
    start_date: date,
    end_date: date,
    _: User | None = Depends(require_admin),
) -> Response:
    # Bulk counterpart of get_purchase_invoice_uploaded_pdf, mirroring
    # get_invoices_pdf_zip in routes/invoices.py: same inclusive-both-ends
    # date window, same one-file-per-invoice zip. What differs is what goes
    # in it — there is no branded render on this side, so the archive can
    # only carry the vendor PDFs that were actually attached. Invoices with
    # nothing attached (or whose file has gone missing from disk) are simply
    # left out rather than failing the whole download, matching the list,
    # which shows a dash for them instead of a Download button.
    start_dt = datetime.combine(start_date, time.min)
    end_dt = datetime.combine(end_date, time.max)

    purchase_invoices = await PurchaseInvoiceDetails.find(
        PurchaseInvoiceDetails.is_deleted == False,  # noqa: E712 — Beanie needs the comparison
        PurchaseInvoiceDetails.date >= start_dt,
        PurchaseInvoiceDetails.date <= end_dt,
    ).to_list()

    buffer = io.BytesIO()
    written = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for purchase_invoice in purchase_invoices:
            if purchase_invoice.uploaded_pdf_path is None:
                continue
            pdf_bytes = read_uploaded_pdf(purchase_invoice.uploaded_pdf_path)
            if pdf_bytes is None:
                continue
            display_no = format_purchase_invoice_no(purchase_invoice.purchase_invoice_no)
            archive.writestr(f"{display_no}.pdf", pdf_bytes)
            written += 1

    if written == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no purchase invoice PDFs found in that date range",
        )

    zip_filename = f"purchase-invoices-{start_date.isoformat()}-to-{end_date.isoformat()}.zip"
    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
