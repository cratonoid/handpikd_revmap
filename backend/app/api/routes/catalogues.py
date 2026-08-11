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
# Saving a catalogue with newly-uploaded pages is a two-phase client flow
# (see catalogue-form-modal.tsx's handleSubmit): add/update_catalogue_details
# first, carrying only already-persisted paths to keep, then one
# add_catalogue_image call per new page. Bundling every page's bytes into a
# single request (the previous design) meant a multi-page catalogue could
# produce a 100+MB request and blow past nginx's client_max_body_size — one
# request per page keeps each bounded to a single rendered page's size.
import base64

from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

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
    PublicCatalogueCategoryGroup,
    PublicCatalogueItem,
    PublicCatalogueSection,
    UpdateCatalogueDetailsRequest,
    UpdateCatalogueDetailsResponse,
    UploadCataloguePdfResponse,
)
from app.services.counters import get_next_id
from app.services.pdf import pdf_to_images
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


@router.post("/upload_catalogue_pdf", response_model=UploadCataloguePdfResponse)
async def upload_catalogue_pdf(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> UploadCataloguePdfResponse:
    pdf_bytes = await file.read()
    try:
        page_images = pdf_to_images(pdf_bytes)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="couldn't read this PDF")

    if not page_images:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF has no pages")

    return UploadCataloguePdfResponse(page_images=[base64.b64encode(image_bytes).decode() for image_bytes in page_images])


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
        image_path = store_catalogue_image(image_bytes, file.filename or "page.png")
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
