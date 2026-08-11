# Request/response bodies for the catalogues module's endpoints.
from pydantic import BaseModel


class AddCatalogueDetailsRequest(BaseModel):
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_id: int
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
    category_id: int
    image_paths: list[str]


class UpdateCatalogueDetailsRequest(BaseModel):
    id: int
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_id: int
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
    # One base64-encoded PNG per PDF page, in page order (see
    # services/pdf.py) — nothing is written to disk here. The frontend shows
    # each as a data: URI thumbnail and lets the admin drop pages it doesn't
    # want; a kept page is only actually stored once Save calls
    # add_catalogue_image for it, so an abandoned upload never leaves a file
    # behind.
    page_images: list[str]


# ---------------------------------------------------------------------------
# Public (unauthenticated) storefront read models — see get_public_catalogues
# below. Catalogues are grouped first by catalogue_type ("brand" | "regular"),
# then by their root category, matching how the /brand-catalogues page renders
# them: one tab per catalogue_type, one subheading per category within it.
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
