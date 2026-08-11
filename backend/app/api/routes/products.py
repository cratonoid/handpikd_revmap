# Products module: endpoints for managing the product catalogue, restricted
# to admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py). `public_router` (get_public_products /
# get_public_categories, for the storefront's /products page) is intentionally
# unauthenticated and separate from every admin endpoint above it, mirroring
# routes/catalogues.py's router/public_router split.
import base64

from beanie.operators import In, NE
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    Category,
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
    ProductImageInput,
    PublicCategoryNode,
    PublicProductItem,
    UpdateProductDetailsRequest,
    UpdateProductDetailsResponse,
    UploadProductImageResponse,
)
from app.services.counters import get_next_id
from app.services.storage import LocalUploadBlockedError
from app.services.storage import delete_product_image as remove_stored_image
from app.services.storage import upload_product_image as store_product_image

router = APIRouter(prefix="/admin", tags=["products"])

# Public/unauthenticated read endpoints for the storefront's /products page —
# unlike the rest of this file, nothing here sits behind require_admin.
public_router = APIRouter(prefix="/products", tags=["products-public"])


async def _validate_hsn_code_product_name(hsn_code: str, product_name: str, exclude_id: int | None = None) -> None:
    query = [ProductDetails.hsn_code == hsn_code, NE(ProductDetails.product_name, product_name)]
    if exclude_id is not None:
        query.append(NE(ProductDetails.id, exclude_id))

    conflicting_product = await ProductDetails.find_one(*query)
    if conflicting_product is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="this hsn code is already used by a product with a different name",
        )


def _decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    # Expects "data:<mime>;base64,<bytes>" (see lib/products.ts's
    # toProductImageInput) — pulls the extension from the mime type so the
    # stored file keeps a sensible name (e.g. .jpeg, not the original
    # filename, which never reaches the backend in this flow).
    header, _, encoded = data_uri.partition(",")
    mime = header.removeprefix("data:").split(";")[0]
    extension = mime.split("/")[-1].split("+")[0] or "bin"
    return base64.b64decode(encoded), extension


async def _replace_images(product_id: int, images: list[ProductImageInput]) -> list[str]:
    # A `data` entry is a file picked via upload_product_image that was
    # never written to disk — this is the first and only time it actually
    # gets stored, so an abandoned add/edit never leaves a file behind.
    try:
        resolved_paths = []
        for image in images:
            if image.path is not None:
                resolved_paths.append(image.path)
                continue
            image_bytes, extension = _decode_data_uri(image.data)
            resolved_paths.append(store_product_image(image_bytes, f"image.{extension}"))
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))

    await ProductImageDetails.find(ProductImageDetails.product_id == product_id).delete()
    for image_path in resolved_paths:
        image_id = await get_next_id(ProductImageIdCounter, "next_product_image_id", ProductImageDetails)
        await ProductImageDetails(id=image_id, product_id=product_id, image_path=image_path).insert()

    return resolved_paths


@router.post("/upload_product_image", response_model=UploadProductImageResponse)
async def upload_product_image(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> UploadProductImageResponse:
    # No disk write here — see ProductImageInput/_replace_images. Just reads
    # the bytes back so the frontend can preview and, on Save, resend them.
    image_bytes = await file.read()
    return UploadProductImageResponse(data=base64.b64encode(image_bytes).decode())


@router.post("/add_product_details", response_model=AddProductDetailsResponse)
async def add_product_details(
    payload: AddProductDetailsRequest,
    _: User | None = Depends(require_admin),
) -> AddProductDetailsResponse:
    vendor = await VendorDetails.get(payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    await _validate_hsn_code_product_name(payload.hsn_code, payload.product_name)

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

    image_paths = await _replace_images(product_id, payload.images)

    return AddProductDetailsResponse(message="product added successfully", image_paths=image_paths)


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

    await _validate_hsn_code_product_name(payload.hsn_code, payload.product_name, exclude_id=product.id)

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

    image_paths = await _replace_images(product.id, payload.images)

    return UpdateProductDetailsResponse(message="product updated successfully", image_paths=image_paths)


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
    remove_stored_image(payload.image_path)

    return DeleteProductImageResponse(message="image deleted successfully")


def _build_public_category_tree(categories: list[Category]) -> list[PublicCategoryNode]:
    nodes_by_id = {
        category.id: PublicCategoryNode(id=category.id, name=category.category_name) for category in categories
    }

    roots: list[PublicCategoryNode] = []
    for category in categories:
        node = nodes_by_id[category.id]
        parent = nodes_by_id.get(category.parent_id) if category.parent_id is not None else None
        (parent.children if parent is not None else roots).append(node)

    return roots


@public_router.get("/get_public_categories", response_model=list[PublicCategoryNode])
async def get_public_categories() -> list[PublicCategoryNode]:
    categories = await Category.find_all().to_list()
    return _build_public_category_tree(categories)


@public_router.get("/get_public_products", response_model=list[PublicProductItem])
async def get_public_products() -> list[PublicProductItem]:
    products = await ProductDetails.find(ProductDetails.is_visible == True).to_list()
    if not products:
        return []

    product_ids = [product.id for product in products]
    images = await ProductImageDetails.find(In(ProductImageDetails.product_id, product_ids)).to_list()
    images_by_product_id: dict[int, list[str]] = {}
    for image in images:
        images_by_product_id.setdefault(image.product_id, []).append(image.image_path)

    return [
        PublicProductItem(
            id=product.id,
            product_name=product.product_name,
            price=product.discounted_price,
            original_price=product.actual_price,
            category_ids=product.category_ids,
            image_paths=images_by_product_id.get(product.id, []),
        )
        for product in products
    ]
