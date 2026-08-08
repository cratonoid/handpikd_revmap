# Request/response bodies for the catalogues module's endpoints.
from pydantic import BaseModel


class AddCatalogueDetailsRequest(BaseModel):
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_id: int
    image_paths: list[str] = []


class AddCatalogueDetailsResponse(BaseModel):
    message: str


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
    image_paths: list[str] = []


class UpdateCatalogueDetailsResponse(BaseModel):
    message: str


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
    # One image URL per PDF page, in page order (see services/pdf.py and
    # services/storage.py's upload_catalogue_image) — the frontend shows one
    # thumbnail per entry and lets the admin drop pages it doesn't want
    # before saving, so nothing here is persisted to catalogue_image_details
    # until add/update_catalogue_details actually saves the form.
    image_paths: list[str]


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
