# Request/response bodies for the products module's endpoints.
from pydantic import BaseModel, model_validator


class ProductImageInput(BaseModel):
    # Exactly one of these is set per image. `path` covers both an
    # already-persisted "/media/..." path and a manually pasted external
    # URL — either way it's stored as-is, nothing to upload. `data` is a
    # file picked this session via upload_product_image that was never
    # written to disk — base64-encoded bytes, stored for the first time by
    # whichever of add/update_product_details this request reaches (see
    # routes/products.py's _replace_images). This is what keeps an image
    # the admin uploads but never saves from ever touching disk at all.
    path: str | None = None
    data: str | None = None

    @model_validator(mode="after")
    def _check_exactly_one(self) -> "ProductImageInput":
        if (self.path is None) == (self.data is None):
            raise ValueError("exactly one of path or data must be set")
        return self


class AddProductDetailsRequest(BaseModel):
    product_name: str
    hsn_code: str
    vendor_id: int
    vendor_rate: float
    actual_price: float
    discounted_price: float
    gst_perc: float
    category_ids: list[int]
    moq: int
    description: str
    is_visible: bool = True
    images: list[ProductImageInput] = []


class AddProductDetailsResponse(BaseModel):
    message: str
    # Resolved paths for every image in `images`, in order — see
    # AddCatalogueDetailsResponse for why the caller needs these back rather
    # than reusing what it sent.
    image_paths: list[str]


class ProductDetailItem(BaseModel):
    id: int
    product_name: str
    hsn_code: str
    vendor_id: int
    vendor_rate: float
    actual_price: float
    discounted_price: float
    gst_perc: float
    category_ids: list[int]
    moq: int
    description: str
    is_visible: bool
    image_paths: list[str]


class UpdateProductDetailsRequest(BaseModel):
    id: int
    product_name: str
    hsn_code: str
    vendor_id: int
    vendor_rate: float
    actual_price: float
    discounted_price: float
    gst_perc: float
    category_ids: list[int]
    moq: int
    description: str
    is_visible: bool = True
    images: list[ProductImageInput] = []


class UpdateProductDetailsResponse(BaseModel):
    message: str
    image_paths: list[str]


class DeleteProductImageRequest(BaseModel):
    product_id: int
    image_path: str


class DeleteProductImageResponse(BaseModel):
    message: str


class UploadProductImageResponse(BaseModel):
    # Base64-encoded bytes of the uploaded image — nothing is written to
    # disk here (see ProductImageInput/_replace_images in
    # routes/products.py). The frontend turns this into a data: URI to
    # preview and hold locally until the form is actually saved.
    data: str


# ---------------------------------------------------------------------------
# Public (unauthenticated) storefront read models — see get_public_products /
# get_public_categories in routes/products.py, backing the /products page.
# Deliberately narrower than ProductDetailItem/CategoryItem: no hsn_code,
# vendor_id, vendor_rate, gst_perc, or moq, none of which the storefront
# needs or should expose.
# ---------------------------------------------------------------------------
class PublicProductItem(BaseModel):
    id: int
    product_name: str
    price: float  # ProductDetails.discounted_price
    original_price: float  # ProductDetails.actual_price, for the strikethrough
    category_ids: list[int]
    image_paths: list[str]


class PublicCategoryNode(BaseModel):
    id: int
    name: str
    children: list["PublicCategoryNode"] = []
