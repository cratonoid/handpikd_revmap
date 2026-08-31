# Request/response bodies for the catalogues module's endpoints.
from pydantic import BaseModel


class AddCatalogueDetailsRequest(BaseModel):
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_ids: list[int]
    is_visible: bool = True
    # Already-persisted pages to keep, in order — always empty for a
    # brand-new catalogue. New pages never travel through this endpoint:
    # each is uploaded separately, one request per page, via
    # add_catalogue_image once this call returns an id — see
    # catalogue-form-modal.tsx's handleSubmit. Bundling every page's bytes
    # into this one request is what caused 413s on multi-page catalogues
    # when this used to carry base64 image data directly.
    image_paths: list[str] = []


class AddCatalogueDetailsResponse(BaseModel):
    message: str
    id: int
    image_paths: list[str]


class CatalogueDetailItem(BaseModel):
    id: int
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_ids: list[int]
    is_visible: bool
    image_paths: list[str]


class UpdateCatalogueDetailsRequest(BaseModel):
    id: int
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_ids: list[int]
    is_visible: bool = True
    # Already-persisted pages to keep, in order — any page dropped from here
    # relative to the catalogue's current set is removed. New pages: see
    # AddCatalogueDetailsRequest.image_paths.
    image_paths: list[str] = []


class UpdateCatalogueDetailsResponse(BaseModel):
    message: str
    id: int
    image_paths: list[str]


class AddCatalogueImageRequest(BaseModel):
    catalogue_id: int


class AddCatalogueImageResponse(BaseModel):
    message: str
    image_path: str


class DeleteCatalogueDetailsRequest(BaseModel):
    id: int


class DeleteCatalogueDetailsResponse(BaseModel):
    message: str


class DeleteCatalogueImageRequest(BaseModel):
    catalogue_id: int
    image_path: str


class DeleteCatalogueImageResponse(BaseModel):
    message: str


class UploadCataloguePdfResponse(BaseModel):
    # Uploading a PDF only stages it and counts its pages — no page image is
    # rendered yet. The frontend then pulls pages one at a time via
    # get_catalogue_pdf_page(session_id, page) for page in range(page_count).
    # Returning every page here (as base64 PNGs, which this used to do) is
    # what made large catalogues impossible: a 107-page catalogue renders to
    # ~400MB of images. See services/catalogue_pdf_staging.py.
    session_id: str
    page_count: int


class DiscardCataloguePdfRequest(BaseModel):
    session_id: str


class DiscardCataloguePdfResponse(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Public (unauthenticated) storefront read models — see get_public_catalogues
# below. Catalogues are grouped first by catalogue_type ("brand" | "regular"),
# then by root category, matching how the /brand-catalogues page renders
# them: one tab per catalogue_type, one subheading per category within it.
# A catalogue carrying several category_ids appears under each of them, so
# the same catalogue id can legitimately show up in more than one group.
# ---------------------------------------------------------------------------
class PublicCatalogueItem(BaseModel):
    id: int
    catalogue_name: str
    vendor_name: str
    image_paths: list[str]


class PublicCatalogueCategoryGroup(BaseModel):
    category_id: int
    category_name: str
    catalogues: list[PublicCatalogueItem]


class PublicCatalogueSection(BaseModel):
    catalogue_type: str
    categories: list[PublicCatalogueCategoryGroup]
