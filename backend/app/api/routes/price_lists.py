# Price lists module: vendor price lists, admin-only. Each one belongs to a
# vendor and can optionally point at one of that catalogue's CatalogueDetails
# rows. The vendor's file is kept exactly as uploaded — a PDF, or an Excel
# workbook (.xlsx / .xls), since vendors send both — rather than rendered
# into page images like a catalogue, so prices stay as real, searchable
# data. It lives in the private document store, never under the public
# /media mount: vendor pricing must not be reachable without signing in.
# get_price_list_file is the only way out.
#
# Add and update are multipart (fields + file in one request), so a price
# list is never saved without its file. On update the file is optional; when
# one is sent it replaces the old file (of either type), which is deleted
# only after the record points at the new one. There is no soft delete:
# delete_price_list removes the record and its file for good.
import io
import zipfile
from datetime import timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.api.deps import require_section
from app.models import CatalogueDetails, PriceListDetails, PriceListIdCounter, Section, User, VendorDetails
from app.models.price_list_details import utc_now
from app.schemas.price_lists import (
    DeletePriceListRequest,
    DeletePriceListResponse,
    PriceListCatalogueOption,
    PriceListDetailItem,
    PriceListSheet,
    PriceListSheetsResponse,
    SavePriceListResponse,
)
from app.services.counters import get_next_id
from app.services.purchase_invoice_storage import delete_uploaded_pdf, read_uploaded_pdf, save_uploaded_file
from app.services.spreadsheet_preview import read_workbook_preview
from app.services.storage import LocalUploadBlockedError

router = APIRouter(prefix="/admin", tags=["price-lists"])

_PRICE_LIST_SUBFOLDER = "price_lists"

# Accepted file types, by the extension they're stored under -> media type.
PRICE_LIST_FILE_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
}

# Legacy .xls is an OLE2 compound file, which is also what an old .doc or
# .ppt is — so the signature alone can't tell them apart, and the extension
# has to agree too.
_OLE2_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def detect_price_list_file_type(file_bytes: bytes, filename: str) -> str | None:
    """The file's type ("pdf" | "xlsx" | "xls") from its contents, or None.

    Checked against the bytes rather than trusted from the name, so a renamed
    file of some other kind is refused instead of being served back later
    under the wrong type.
    """
    # Every PDF opens with a %PDF- header (some writers put a few junk bytes
    # first, which readers tolerate, hence the search rather than startswith).
    if b"%PDF-" in file_bytes[:1024]:
        return "pdf"

    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # .xlsx is a zip, as are .docx/.pptx and plain zips — a workbook is the
    # one with xl/workbook.xml inside.
    if file_bytes.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
                if "xl/workbook.xml" in archive.namelist():
                    return "xlsx"
        except zipfile.BadZipFile:
            return None
        return None

    if file_bytes.startswith(_OLE2_SIGNATURE) and extension == "xls":
        return "xls"

    return None


def _file_type_of(file_path: str) -> str:
    return file_path.rsplit(".", 1)[-1].lower()


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


# Reads, checks and stores the uploaded file; returns its storage key.
async def _store_upload(file: UploadFile) -> str:
    file_bytes = await file.read()
    file_type = detect_price_list_file_type(file_bytes, file.filename or "")
    if file_type is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="file must be a PDF or an Excel workbook"
        )
    try:
        return save_uploaded_file(file_bytes, file_type, subfolder=_PRICE_LIST_SUBFOLDER)
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
    file_path = await _store_upload(file)

    price_list_id = await get_next_id(PriceListIdCounter, "next_price_list_id", PriceListDetails)
    await PriceListDetails(
        id=price_list_id,
        price_list_name=price_list_name.strip(),
        vendor_id=vendor_id,
        catalogue_id=catalogue_id,
        notes=notes.strip(),
        file_path=file_path,
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
            file_type=_file_type_of(price_list.file_path),
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

    previous_file_path: str | None = None
    if file is not None:
        new_file_path = await _store_upload(file)
        previous_file_path = price_list.file_path
        price_list.file_path = new_file_path
        price_list.original_filename = file.filename or ""
        price_list.uploaded_at = utc_now()

    price_list.price_list_name = price_list_name.strip()
    price_list.vendor_id = vendor_id
    price_list.catalogue_id = catalogue_id
    price_list.notes = notes.strip()
    await price_list.save()

    # Only once the record points at the new file, so a failed save never
    # loses the file it still references.
    if previous_file_path is not None:
        delete_uploaded_pdf(previous_file_path)

    return SavePriceListResponse(message="price list updated successfully", id=price_list.id)


@router.get("/get_price_list_file")
async def get_price_list_file(
    price_list_id: int = Query(...),
    _: User | None = Depends(require_section(Section.price_lists)),
) -> Response:
    price_list = await _get_price_list_or_404(price_list_id)
    file_bytes = read_uploaded_pdf(price_list.file_path)
    if file_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="price list file is missing")

    file_type = _file_type_of(price_list.file_path)
    # A PDF opens in the browser's viewer; a workbook can't be shown inline,
    # so it downloads. The RFC 5987 form carries names with non-ASCII
    # characters intact.
    disposition = "inline" if file_type == "pdf" else "attachment"
    filename = quote(f"{price_list.price_list_name}.{file_type}")
    return Response(
        content=file_bytes,
        media_type=PRICE_LIST_FILE_TYPES.get(file_type, "application/octet-stream"),
        headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{filename}"},
    )


@router.get("/get_price_list_sheets", response_model=PriceListSheetsResponse)
async def get_price_list_sheets(
    price_list_id: int = Query(...),
    _: User | None = Depends(require_section(Section.price_lists)),
) -> PriceListSheetsResponse:
    # The in-browser view of an Excel price list: browsers can't render a
    # workbook, so it's read here into text cells instead.
    price_list = await _get_price_list_or_404(price_list_id)
    file_type = _file_type_of(price_list.file_path)
    if file_type not in ("xlsx", "xls"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="price list is not an Excel workbook")

    file_bytes = read_uploaded_pdf(price_list.file_path)
    if file_bytes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="price list file is missing")

    # Parsing a large workbook is CPU-bound, so it runs off the event loop.
    try:
        previews = await run_in_threadpool(read_workbook_preview, file_bytes, file_type)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="couldn't read this workbook")

    return PriceListSheetsResponse(
        sheets=[
            PriceListSheet(name=preview.name, rows=preview.rows, truncated=preview.truncated)
            for preview in previews
        ]
    )


@router.post("/delete_price_list", response_model=DeletePriceListResponse)
async def delete_price_list(
    payload: DeletePriceListRequest,
    _: User | None = Depends(require_section(Section.price_lists)),
) -> DeletePriceListResponse:
    price_list = await _get_price_list_or_404(payload.id)
    await price_list.delete()
    delete_uploaded_pdf(price_list.file_path)
    return DeletePriceListResponse(message="price list deleted successfully")
