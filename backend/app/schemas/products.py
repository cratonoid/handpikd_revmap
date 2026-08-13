# Request/response bodies for the products module's endpoints.
from pydantic import BaseModel, Field


class AddProductDetailsRequest(BaseModel):
    product_name: str
    hsn_code: str
    vendor_id: int
    vendor_rate: float = Field(gt=0)
    actual_price: float = Field(gt=0)
    discounted_price: float = Field(gt=0)
    gst_perc: float
    category_ids: list[int]
    moq: int
    description: str
    is_visible: bool = True
    # Already-persisted paths/pasted URLs to keep, in order — always empty
    # for a brand-new product. New images never travel through this
    # endpoint: each is uploaded separately, one request per image, via
    # add_product_image once this call returns an id — see
    # product-form-modal.tsx's handleSubmit. Bundling every image's bytes
    # into this one request risked the same request-size blowup fixed for
    # catalogues (see routes/catalogues.py's module docstring).
    image_paths: list[str] = []


class AddProductDetailsResponse(BaseModel):
    message: str
    id: int
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
    vendor_rate: float = Field(gt=0)
    actual_price: float = Field(gt=0)
    discounted_price: float = Field(gt=0)
    gst_perc: float
    category_ids: list[int]
    moq: int
    description: str
    is_visible: bool = True
    # Already-persisted paths/pasted URLs to keep. New images: see
    # AddProductDetailsRequest.image_paths.
    image_paths: list[str] = []


class UpdateProductDetailsResponse(BaseModel):
    message: str
    id: int
    image_paths: list[str]


class DeleteProductImageRequest(BaseModel):
    product_id: int
    image_path: str


class DeleteProductImageResponse(BaseModel):
    message: str


class UploadProductImageResponse(BaseModel):
    # Base64-encoded bytes of the just-picked image — nothing is written to
    # disk here. The frontend turns this into a data: URI to preview and
    # hold locally; it's only actually stored once Save calls
    # add_product_image for it (see routes/products.py).
    data: str


class AddProductImageRequest(BaseModel):
    product_id: int


class AddProductImageResponse(BaseModel):
    message: str
    image_path: str


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
