# Catalogues module: endpoints for managing vendor/brand catalogues. `router`
# (admin CRUD) is restricted to admins (bypassed entirely when
# settings.auth_enabled is False, matching require_admin in
# routes/admin.py); `public_router` (get_public_catalogues, for the
# storefront's /brand-catalogues page) is intentionally unauthenticated. A
# catalogue's images always come from an admin-uploaded PDF (see
# upload_catalogue_pdf) rather than individual image uploads — the PDF is
# rendered page-by-page into images the admin can drop pages from before
# saving. Unlike Products/Vendors, catalogues have no soft-delete flag:
# delete_catalogue_details removes the catalogue, its image rows, and the
# underlying files for good.
#
# Both directions of that PDF flow are paged, for the same reason. Intake:
# upload_catalogue_pdf only stages the PDF and counts its pages, then the
# client fetches each rendered page from get_catalogue_pdf_page and calls
# discard_catalogue_pdf when it's done — returning all the pages from the
# upload call (the previous design) meant a 107-page catalogue had to produce
# ~400MB in one response.
#
# Saving a catalogue with newly-uploaded pages is a two-phase client flow
# (see catalogue-form-modal.tsx's handleSubmit): add/update_catalogue_details
# first, carrying only already-persisted paths to keep, then one
# add_catalogue_image call per new page. Bundling every page's bytes into a
# single request (the previous design) meant a multi-page catalogue could
# produce a 100+MB request and blow past nginx's client_max_body_size — one
# request per page keeps each bounded to a single rendered page's size.
from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    CatalogueDetails,
    CatalogueIdCounter,
    CatalogueImageDetails,
    CatalogueImageIdCounter,
    Category,
    User,
    VendorDetails,
)
from app.schemas.catalogues import (
    AddCatalogueDetailsRequest,
    AddCatalogueDetailsResponse,
    AddCatalogueImageResponse,
    CatalogueDetailItem,
    DeleteCatalogueDetailsRequest,
    DeleteCatalogueDetailsResponse,
    DeleteCatalogueImageRequest,
    DeleteCatalogueImageResponse,
    DiscardCataloguePdfRequest,
    DiscardCataloguePdfResponse,
    PublicCatalogueCategoryGroup,
    PublicCatalogueItem,
    PublicCatalogueSection,
    UpdateCatalogueDetailsRequest,
    UpdateCatalogueDetailsResponse,
    UploadCataloguePdfResponse,
)
from app.services.catalogue_pdf_staging import (
    StagedPdfNotFoundError,
    count_staged_pages,
    create_staging_session,
    discard_staged_pdf,
    render_staged_page,
)
from app.services.counters import get_next_id
from app.services.pdf import PAGE_IMAGE_EXTENSION, PAGE_IMAGE_MEDIA_TYPE, PageIndexError
from app.services.storage import LocalUploadBlockedError
from app.services.storage import delete_catalogue_image as remove_stored_image
from app.services.storage import upload_catalogue_image as store_catalogue_image

router = APIRouter(prefix="/admin", tags=["catalogues"])

# Public/unauthenticated read endpoint for the storefront's /brand-catalogues
# page — unlike the rest of this file, nothing here sits behind require_admin.
public_router = APIRouter(prefix="/catalogues", tags=["catalogues-public"])


async def _replace_image_paths(catalogue_id: int, image_paths: list[str]) -> None:
    await CatalogueImageDetails.find(CatalogueImageDetails.catalogue_id == catalogue_id).delete()
    for image_path in image_paths:
        image_id = await get_next_id(CatalogueImageIdCounter, "next_catalogue_image_id", CatalogueImageDetails)
        await CatalogueImageDetails(id=image_id, catalogue_id=catalogue_id, image_path=image_path).insert()


async def _require_vendor_and_category(vendor_id: int, category_id: int) -> None:
    vendor = await VendorDetails.get(vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    category = await Category.get(category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="category not found")


# Written to disk a megabyte at a time rather than via a single
# `await file.read()`: catalogue PDFs run to hundreds of megabytes, and
# reading one whole would put all of it in the backend's memory at once.
_PDF_UPLOAD_CHUNK_SIZE = 1024 * 1024


@router.post("/upload_catalogue_pdf", response_model=UploadCataloguePdfResponse)
async def upload_catalogue_pdf(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> UploadCataloguePdfResponse:
    # Stages the PDF and reports how many pages it has; the client then asks
    # for those pages one at a time (get_catalogue_pdf_page). Rendering every
    # page here and returning them together is what this used to do, and it
    # couldn't handle a real catalogue — see services/catalogue_pdf_staging.py.
    session_id, staged_path = create_staging_session()

    # The failure is recorded and acted on below rather than handled inside
    # the except block, because cleaning up there doesn't work: while the
    # exception is still live, its traceback keeps PyMuPDF's half-opened
    # Document alive, and on Windows that open handle makes the staged file
    # undeletable. Once the block has exited the handle is released and the
    # discard succeeds.
    failure: str | None = None
    page_count = 0
    try:
        with staged_path.open("wb") as staged_file:
            while chunk := await file.read(_PDF_UPLOAD_CHUNK_SIZE):
                staged_file.write(chunk)
        page_count = count_staged_pages(session_id)
    except Exception:
        failure = "couldn't read this PDF"

    if failure is None and page_count == 0:
        failure = "PDF has no pages"

    if failure is not None:
        discard_staged_pdf(session_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=failure)

    return UploadCataloguePdfResponse(session_id=session_id, page_count=page_count)


# Deliberately `def`, not `async def`: rendering a page is CPU-bound and takes
# a few hundred milliseconds, so FastAPI running it in a threadpool keeps the
# event loop free for the rest of the app while a long catalogue converts.
# Returns the image bytes directly instead of base64 in JSON — a third fewer
# bytes, and the browser can hold the result as an object URL rather than
# keeping a base64 string of every page alive in memory.
@router.get("/get_catalogue_pdf_page", response_class=Response)
def get_catalogue_pdf_page(
    session_id: str = Query(...),
    page: int = Query(..., ge=0),
    _: User | None = Depends(require_admin),
) -> Response:
    try:
        image_bytes = render_staged_page(session_id, page)
    except StagedPdfNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    except PageIndexError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="page not found")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="couldn't render this page")

    return Response(content=image_bytes, media_type=PAGE_IMAGE_MEDIA_TYPE)


@router.post("/discard_catalogue_pdf", response_model=DiscardCataloguePdfResponse)
async def discard_catalogue_pdf(
    payload: DiscardCataloguePdfRequest,
    _: User | None = Depends(require_admin),
) -> DiscardCataloguePdfResponse:
    # Called by the client once it has pulled every page it needs, so the
    # staged PDF goes away immediately instead of waiting for the TTL sweep.
    # Unknown/already-swept sessions are a no-op, so this is safe to fire and
    # forget.
    discard_staged_pdf(payload.session_id)
    return DiscardCataloguePdfResponse(message="upload discarded")


@router.post("/add_catalogue_details", response_model=AddCatalogueDetailsResponse)
async def add_catalogue_details(
    payload: AddCatalogueDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddCatalogueDetailsResponse:
    await _require_vendor_and_category(payload.catalogue_vendor_id, payload.category_id)

    catalogue_id = await get_next_id(CatalogueIdCounter, "next_catalogue_id", CatalogueDetails)
    catalogue = CatalogueDetails(
        id=catalogue_id,
        catalogue_name=payload.catalogue_name,
        catalogue_vendor_id=payload.catalogue_vendor_id,
        catalogue_type=payload.catalogue_type,
        category_id=payload.category_id,
    )
    await catalogue.insert()

    await _replace_image_paths(catalogue_id, payload.image_paths)

    return AddCatalogueDetailsResponse(message="catalogue added successfully", id=catalogue_id, image_paths=payload.image_paths)


@router.get("/get_catalogue_details", response_model=list[CatalogueDetailItem])
async def get_catalogue_details(
    _: User | None = Depends(require_admin),
) -> list[CatalogueDetailItem]:
    catalogues = await CatalogueDetails.find_all().to_list()
    if not catalogues:
        return []

    catalogue_ids = [catalogue.id for catalogue in catalogues]
    images = await CatalogueImageDetails.find(In(CatalogueImageDetails.catalogue_id, catalogue_ids)).to_list()
    images_by_catalogue_id: dict[int, list[str]] = {}
    for image in images:
        images_by_catalogue_id.setdefault(image.catalogue_id, []).append(image.image_path)

    return [
        CatalogueDetailItem(
            id=catalogue.id,
            catalogue_name=catalogue.catalogue_name,
            catalogue_vendor_id=catalogue.catalogue_vendor_id,
            catalogue_type=catalogue.catalogue_type,
            category_id=catalogue.category_id,
            image_paths=images_by_catalogue_id.get(catalogue.id, []),
        )
        for catalogue in catalogues
    ]


@router.post("/update_catalogue_details", response_model=UpdateCatalogueDetailsResponse)
async def update_catalogue_details(
    payload: UpdateCatalogueDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateCatalogueDetailsResponse:
    catalogue = await CatalogueDetails.get(payload.id)
    if catalogue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="catalogue not found")

    await _require_vendor_and_category(payload.catalogue_vendor_id, payload.category_id)

    catalogue.catalogue_name = payload.catalogue_name
    catalogue.catalogue_vendor_id = payload.catalogue_vendor_id
    catalogue.catalogue_type = payload.catalogue_type
    catalogue.category_id = payload.category_id
    await catalogue.save()

    await _replace_image_paths(catalogue.id, payload.image_paths)

    return UpdateCatalogueDetailsResponse(message="catalogue updated successfully", id=catalogue.id, image_paths=payload.image_paths)


@router.post("/add_catalogue_image", response_model=AddCatalogueImageResponse)
async def add_catalogue_image(
    catalogue_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AddCatalogueImageResponse:
    # Persists one page for an already-saved catalogue — see the module
    # docstring above for why this is a separate, per-page call rather than
    # bundled into add/update_catalogue_details.
    catalogue = await CatalogueDetails.get(catalogue_id)
    if catalogue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="catalogue not found")

    image_bytes = await file.read()
    try:
        image_path = store_catalogue_image(image_bytes, file.filename or f"page.{PAGE_IMAGE_EXTENSION}")
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))

    image_id = await get_next_id(CatalogueImageIdCounter, "next_catalogue_image_id", CatalogueImageDetails)
    await CatalogueImageDetails(id=image_id, catalogue_id=catalogue_id, image_path=image_path).insert()

    return AddCatalogueImageResponse(message="image added successfully", image_path=image_path)


@router.post("/delete_catalogue_details", response_model=DeleteCatalogueDetailsResponse)
async def delete_catalogue_details(
    payload: DeleteCatalogueDetailsRequest,
    _: User | None = Depends(require_admin),
) -> DeleteCatalogueDetailsResponse:
    catalogue = await CatalogueDetails.get(payload.id)
    if catalogue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="catalogue not found")

    images = await CatalogueImageDetails.find(CatalogueImageDetails.catalogue_id == catalogue.id).to_list()
    for image in images:
        remove_stored_image(image.image_path)
    await CatalogueImageDetails.find(CatalogueImageDetails.catalogue_id == catalogue.id).delete()

    await catalogue.delete()

    return DeleteCatalogueDetailsResponse(message="catalogue deleted successfully")


@router.post("/delete_catalogue_image", response_model=DeleteCatalogueImageResponse)
async def delete_catalogue_image(
    payload: DeleteCatalogueImageRequest,
    _: User | None = Depends(require_admin),
) -> DeleteCatalogueImageResponse:
    catalogue = await CatalogueDetails.get(payload.catalogue_id)
    if catalogue is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="catalogue not found")

    image = await CatalogueImageDetails.find_one(
        CatalogueImageDetails.catalogue_id == payload.catalogue_id,
        CatalogueImageDetails.image_path == payload.image_path,
    )
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="image not found")

    await image.delete()
    remove_stored_image(payload.image_path)

    return DeleteCatalogueImageResponse(message="image deleted successfully")


@public_router.get("/get_public_catalogues", response_model=list[PublicCatalogueSection])
async def get_public_catalogues() -> list[PublicCatalogueSection]:
    catalogues = await CatalogueDetails.find_all().to_list()
    if not catalogues:
        return []

    catalogue_ids = [catalogue.id for catalogue in catalogues]
    vendor_ids = list({catalogue.catalogue_vendor_id for catalogue in catalogues})
    category_ids = list({catalogue.category_id for catalogue in catalogues})

    images = await CatalogueImageDetails.find(In(CatalogueImageDetails.catalogue_id, catalogue_ids)).to_list()
    images_by_catalogue_id: dict[int, list[str]] = {}
    for image in images:
        images_by_catalogue_id.setdefault(image.catalogue_id, []).append(image.image_path)

    vendors = await VendorDetails.find(In(VendorDetails.id, vendor_ids)).to_list()
    vendor_name_by_id = {vendor.id: vendor.registered_name for vendor in vendors}

    categories = await Category.find(In(Category.id, category_ids)).to_list()
    category_name_by_id = {category.id: category.category_name for category in categories}

    # catalogue_type -> category_id -> items, built in one pass, then turned
    # into the nested response shape below.
    grouped: dict[str, dict[int, list[PublicCatalogueItem]]] = {}
    for catalogue in catalogues:
        item = PublicCatalogueItem(
            id=catalogue.id,
            catalogue_name=catalogue.catalogue_name,
            vendor_name=vendor_name_by_id.get(catalogue.catalogue_vendor_id, ""),
            image_paths=images_by_catalogue_id.get(catalogue.id, []),
        )
        grouped.setdefault(catalogue.catalogue_type, {}).setdefault(catalogue.category_id, []).append(item)

    sections: list[PublicCatalogueSection] = []
    for catalogue_type, categories_map in grouped.items():
        category_groups = [
            PublicCatalogueCategoryGroup(
                category_id=category_id,
                category_name=category_name_by_id.get(category_id, "Uncategorized"),
                catalogues=sorted(items, key=lambda item: item.catalogue_name),
            )
            for category_id, items in categories_map.items()
        ]
        category_groups.sort(key=lambda group: group.category_name)
        sections.append(PublicCatalogueSection(catalogue_type=catalogue_type, categories=category_groups))

    # "brand" sorts before "regular" alphabetically, which also happens to be
    # the desired tab order (Brand Catalogs, then Category Wise Catalogs).
    sections.sort(key=lambda section: section.catalogue_type)
    return sections
