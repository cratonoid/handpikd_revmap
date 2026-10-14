# Price lists module: vendor price-list PDFs, admin-only. Each one belongs to
# a vendor and can optionally point at one of that catalogue's
# CatalogueDetails rows. Unlike catalogues, the PDF is kept as the original
# file rather than rendered into page images — prices stay as real,
# searchable text — and it lives in the private PDF store, never under the
# public /media mount: vendor pricing must not be reachable without signing
# in. get_price_list_pdf is the only way out.
#
# Add and update are multipart (fields + PDF in one request), so a price list
# is never saved without its file. On update the file is optional; when one
# is sent it replaces the old PDF, which is deleted only after the record
# points at the new one. There is no soft delete: delete_price_list removes
# the record and its PDF for good.
from datetime import timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from app.api.deps import require_section
from app.models import CatalogueDetails, PriceListDetails, PriceListIdCounter, Section, User, VendorDetails
from app.models.price_list_details import utc_now
from app.schemas.price_lists import (
    DeletePriceListRequest,
    DeletePriceListResponse,
    PriceListCatalogueOption,
    PriceListDetailItem,
    SavePriceListResponse,
)
from app.services.counters import get_next_id
from app.services.purchase_invoice_storage import delete_uploaded_pdf, read_uploaded_pdf, save_uploaded_pdf
from app.services.storage import LocalUploadBlockedError

router = APIRouter(prefix="/admin", tags=["price-lists"])

_PRICE_LIST_SUBFOLDER = "price_lists"


async def _get_price_list_or_404(price_list_id: int) -> PriceListDetails:
    price_list = await PriceListDetails.get(price_list_id)
    if price_list is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="price list not found")
    return price_list


async def _require_vendor_and_catalogue(vendor_id: int, catalogue_id: int | None) -> None:
    if await VendorDetails.get(vendor_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")
    if catalogue_id is not None and await CatalogueDetails.get(catalogue_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="catalogue not found")


async def _read_pdf(file: UploadFile) -> bytes:
    pdf_bytes = await file.read()
    # Every PDF opens with a %PDF- header (some writers put a few junk bytes
    # first, which readers tolerate, hence the search rather than startswith).
    if b"%PDF-" not in pdf_bytes[:1024]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="file is not a PDF")
    return pdf_bytes


def _store_pdf(pdf_bytes: bytes) -> str:
    try:
        return save_uploaded_pdf(pdf_bytes, subfolder=_PRICE_LIST_SUBFOLDER)
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))


@router.post("/add_price_list", response_model=SavePriceListResponse)
async def add_price_list(
    price_list_name: str = Form(...),
    vendor_id: int = Form(...),
    catalogue_id: int | None = Form(None),
    notes: str = Form(""),
    file: UploadFile = File(...),
    _: User | None = Depends(require_section(Section.price_lists)),
) -> SavePriceListResponse:
    await _require_vendor_and_catalogue(vendor_id, catalogue_id)
    pdf_bytes = await _read_pdf(file)
    pdf_path = _store_pdf(pdf_bytes)

    price_list_id = await get_next_id(PriceListIdCounter, "next_price_list_id", PriceListDetails)
    await PriceListDetails(
        id=price_list_id,
        price_list_name=price_list_name.strip(),
        vendor_id=vendor_id,
        catalogue_id=catalogue_id,
        notes=notes.strip(),
        pdf_path=pdf_path,
        original_filename=file.filename or "",
    ).insert()

    return SavePriceListResponse(message="price list added successfully", id=price_list_id)


@router.get("/get_price_list_details", response_model=list[PriceListDetailItem])
async def get_price_list_details(
    _: User | None = Depends(require_section(Section.price_lists)),
) -> list[PriceListDetailItem]:
    price_lists = await PriceListDetails.find_all().sort(-PriceListDetails.uploaded_at).to_list()
    return [
        PriceListDetailItem(
            id=price_list.id,
            price_list_name=price_list.price_list_name,
            vendor_id=price_list.vendor_id,
            catalogue_id=price_list.catalogue_id,
            notes=price_list.notes,
            original_filename=price_list.original_filename,
            # Stored naive UTC; sent tz-aware so the frontend renders it in IST.
            uploaded_at=price_list.uploaded_at.replace(tzinfo=timezone.utc),
        )
        for price_list in price_lists
    ]


@router.get("/get_price_list_catalogue_options", response_model=list[PriceListCatalogueOption])
async def get_price_list_catalogue_options(
    _: User | None = Depends(require_section(Section.price_lists)),
) -> list[PriceListCatalogueOption]:
    catalogues = await CatalogueDetails.find_all().sort(+CatalogueDetails.catalogue_name).to_list()
    return [
        PriceListCatalogueOption(
            id=catalogue.id,
            catalogue_name=catalogue.catalogue_name,
            vendor_id=catalogue.catalogue_vendor_id,
        )
        for catalogue in catalogues
    ]


@router.post("/update_price_list", response_model=SavePriceListResponse)
async def update_price_list(
    id: int = Form(...),
    price_list_name: str = Form(...),
    vendor_id: int = Form(...),
    catalogue_id: int | None = Form(None),
    notes: str = Form(""),
    file: UploadFile | None = File(None),
    _: User | None = Depends(require_section(Section.price_lists)),
) -> SavePriceListResponse:
    price_list = await _get_price_list_or_404(id)
    await _require_vendor_and_catalogue(vendor_id, catalogue_id)

    previous_pdf_path: str | None = None
    if file is not None:
        pdf_bytes = await _read_pdf(file)
        previous_pdf_path = price_list.pdf_path
        price_list.pdf_path = _store_pdf(pdf_bytes)
        price_list.original_filename = file.filename or ""
        price_list.uploaded_at = utc_now()

    price_list.price_list_name = price_list_name.strip()
    price_list.vendor_id = vendor_id
    price_list.catalogue_id = catalogue_id
    price_list.notes = notes.strip()
    await price_list.save()

    # Only once the record points at the new file, so a failed save never
    # loses the PDF it still references.
    if previous_pdf_path is not None:
        delete_uploaded_pdf(previous_pdf_path)

    return SavePriceListResponse(message="price list updated successfully", id=price_list.id)


@router.get("/get_price_list_pdf")
async def get_price_list_pdf(
    price_list_id: int = Query(...),
    _: User | None = Depends(require_section(Section.price_lists)),
) -> Response:
    price_list = await _get_price_list_or_404(price_list_id)
    pdf_bytes = read_uploaded_pdf(price_list.pdf_path)
    if pdf_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="price list PDF file is missing")

    # inline so the browser opens it in its PDF viewer; the RFC 5987 form
    # carries names with non-ASCII characters intact.
    filename = quote(f"{price_list.price_list_name}.pdf")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{filename}"},
    )


@router.post("/delete_price_list", response_model=DeletePriceListResponse)
async def delete_price_list(
    payload: DeletePriceListRequest,
    _: User | None = Depends(require_section(Section.price_lists)),
) -> DeletePriceListResponse:
    price_list = await _get_price_list_or_404(payload.id)
    await price_list.delete()
    delete_uploaded_pdf(price_list.pdf_path)
    return DeletePriceListResponse(message="price list deleted successfully")

