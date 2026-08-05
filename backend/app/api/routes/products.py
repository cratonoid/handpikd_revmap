# Products module: endpoints for managing the product catalogue, restricted
# to admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
from beanie.operators import In
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import (
    ProductDetails,
    ProductIdCounter,
    ProductImageDetails,
    ProductImageIdCounter,
    User,
    VendorDetails,
)
from app.schemas.products import (
    AddProductDetailsRequest,
    AddProductDetailsResponse,
    DeleteProductImageRequest,
    DeleteProductImageResponse,
    ProductDetailItem,
    UpdateProductDetailsRequest,
    UpdateProductDetailsResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin", tags=["products"])


async def _replace_image_paths(product_id: int, image_paths: list[str]) -> None:
    await ProductImageDetails.find(ProductImageDetails.product_id == product_id).delete()
    for image_path in image_paths:
        image_id = await get_next_id(ProductImageIdCounter, "next_product_image_id", ProductImageDetails)
        await ProductImageDetails(id=image_id, product_id=product_id, image_path=image_path).insert()


@router.post("/add_product_details", response_model=AddProductDetailsResponse)
async def add_product_details(
    payload: AddProductDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddProductDetailsResponse:
    vendor = await VendorDetails.get(payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    product_id = await get_next_id(ProductIdCounter, "next_product_id", ProductDetails)
    product = ProductDetails(
        id=product_id,
        product_name=payload.product_name,
        hsn_code=payload.hsn_code,
        vendor_id=payload.vendor_id,
        vendor_rate=payload.vendor_rate,
        actual_price=payload.actual_price,
        discounted_price=payload.discounted_price,
        gst_perc=payload.gst_perc,
        category_ids=payload.category_ids,
        moq=payload.moq,
        description=payload.description,
        is_visible=payload.is_visible,
    )
    await product.insert()

    await _replace_image_paths(product_id, payload.image_paths)

    return AddProductDetailsResponse(message="product added successfully")


@router.get("/get_product_details", response_model=list[ProductDetailItem])
async def get_product_details(
    _: User | None = Depends(require_admin),
) -> list[ProductDetailItem]:
    products = await ProductDetails.find_all().to_list()
    if not products:
        return []

    product_ids = [product.id for product in products]
    images = await ProductImageDetails.find(In(ProductImageDetails.product_id, product_ids)).to_list()
    images_by_product_id: dict[int, list[str]] = {}
    for image in images:
        images_by_product_id.setdefault(image.product_id, []).append(image.image_path)

    return [
        ProductDetailItem(
            id=product.id,
            product_name=product.product_name,
            hsn_code=product.hsn_code,
            vendor_id=product.vendor_id,
            vendor_rate=product.vendor_rate,
            actual_price=product.actual_price,
            discounted_price=product.discounted_price,
            gst_perc=product.gst_perc,
            category_ids=product.category_ids,
            moq=product.moq,
            description=product.description,
            is_visible=product.is_visible,
            image_paths=images_by_product_id.get(product.id, []),
        )
        for product in products
    ]


@router.post("/update_product_details", response_model=UpdateProductDetailsResponse)
async def update_product_details(
    payload: UpdateProductDetailsRequest,
    _: User | None = Depends(require_admin),
) -> UpdateProductDetailsResponse:
    product = await ProductDetails.get(payload.id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    vendor = await VendorDetails.get(payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    product.product_name = payload.product_name
    product.hsn_code = payload.hsn_code
    product.vendor_id = payload.vendor_id
    product.vendor_rate = payload.vendor_rate
    product.actual_price = payload.actual_price
    product.discounted_price = payload.discounted_price
    product.gst_perc = payload.gst_perc
    product.category_ids = payload.category_ids
    product.moq = payload.moq
    product.description = payload.description
    product.is_visible = payload.is_visible
    await product.save()

    await _replace_image_paths(product.id, payload.image_paths)

    return UpdateProductDetailsResponse(message="product updated successfully")


@router.post("/delete_product_image", response_model=DeleteProductImageResponse)
async def delete_product_image(
    payload: DeleteProductImageRequest,
    _: User | None = Depends(require_admin),
) -> DeleteProductImageResponse:
    product = await ProductDetails.get(payload.product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    image = await ProductImageDetails.find_one(
        ProductImageDetails.product_id == payload.product_id,
        ProductImageDetails.image_path == payload.image_path,
    )
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="image not found")

    await image.delete()

    return DeleteProductImageResponse(message="image deleted successfully")
