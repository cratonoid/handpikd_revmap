# Request/response bodies for the products module's endpoints.
from pydantic import BaseModel


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
    image_paths: list[str] = []


class AddProductDetailsResponse(BaseModel):
    message: str


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
    image_paths: list[str] = []


class UpdateProductDetailsResponse(BaseModel):
    message: str


class DeleteProductImageRequest(BaseModel):
    product_id: int
    image_path: str


class DeleteProductImageResponse(BaseModel):
    message: str


class UploadProductImageResponse(BaseModel):
    # Public CDN URL of the just-uploaded image (see services/storage.py) —
    # the frontend adds this to its imagePaths list, which then gets
    # persisted as a product_image_details row on the next add/update save.
    url: str


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
