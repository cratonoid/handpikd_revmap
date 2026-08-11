# Request/response bodies for the catalogues module's endpoints.
from pydantic import BaseModel, model_validator


class CatalogueImageInput(BaseModel):
    # Exactly one of these is set per page. `path` keeps an already-persisted
    # page as-is (nothing re-uploaded); `data` is a page rendered this
    # session by upload_catalogue_pdf that was never written to disk — it's
    # base64-encoded PNG bytes, stored for the first time by whichever of
    # add/update_catalogue_details this request reaches (see
    # routes/catalogues.py's _replace_images). This is what keeps a page the
    # admin uploads but never saves from ever touching disk at all.
    path: str | None = None
    data: str | None = None

    @model_validator(mode="after")
    def _check_exactly_one(self) -> "CatalogueImageInput":
        if (self.path is None) == (self.data is None):
            raise ValueError("exactly one of path or data must be set")
        return self


class AddCatalogueDetailsRequest(BaseModel):
    catalogue_name: str
    catalogue_vendor_id: int
    catalogue_type: str
    category_id: int
    images: list[CatalogueImageInput] = []


class AddCatalogueDetailsResponse(BaseModel):
    message: str
    # Resolved paths for every image in `images`, in order — lets the caller
    # update its local state with real /media paths instead of the base64
    # data URIs it was holding for any page that was new this session.
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
    images: list[CatalogueImageInput] = []


class UpdateCatalogueDetailsResponse(BaseModel):
    message: str
    image_paths: list[str]


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
    # want; only add/update_catalogue_details (see CatalogueImageInput)
    # actually stores the bytes, so an abandoned upload never leaves a file
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
