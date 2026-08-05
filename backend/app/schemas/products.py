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
