# Products module: endpoints for managing the product catalogue, restricted
# to admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py). `public_router` (get_public_products /
# get_public_categories, for the storefront's /products page) is intentionally
# unauthenticated and separate from every admin endpoint above it, mirroring
# routes/catalogues.py's router/public_router split.
#
# Saving a product with newly-uploaded images is a two-phase client flow
# (see product-form-modal.tsx's handleSubmit), same as catalogues: add/
# update_product_details first, carrying only already-persisted paths/pasted
# URLs to keep, then one add_product_image call per new image — see
# routes/catalogues.py's module docstring for why bundling every image's
# bytes into a single request doesn't scale.
import base64

from beanie.operators import In
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.routes.admin import require_admin
from app.models import (
    Category,
    ProductDetails,
    ProductIdCounter,
    ProductImageDetails,
    ProductImageIdCounter,
    ProformaInvoiceSummary,
    PurchaseSummary,
    QuotationSummary,
    SalesSummary,
    User,
    VendorDetails,
)
from app.schemas.products import (
    AddProductDetailsRequest,
    AddProductDetailsResponse,
    AddProductImageResponse,
    DeleteProductDetailsRequest,
    DeleteProductDetailsResponse,
    DeleteProductImageRequest,
    DeleteProductImageResponse,
    ProductDetailItem,
    PublicCategoryNode,
    PublicProductItem,
    RestoreProductDetailsRequest,
    RestoreProductDetailsResponse,
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


def _normalised_product_name(product_name: str) -> str:
    # Used for duplicate detection only — the name is stored exactly as the
    # admin typed it.
    return " ".join(product_name.split()).casefold()


async def _validate_hsn_code_product_name(hsn_code: str, product_name: str, exclude_id: int | None = None) -> None:
    # An HSN code is a tax classification, not an identity, so any number of
    # products can share one — what they can't share is the pair. Two products
    # filed under the same HSN code have to be told apart by name, since that
    # pair is all an invoice line shows. Names are compared ignoring case and
    # surrounding/repeated whitespace so "Blue Mug" and "blue  mug" count as
    # the same product rather than as two.
    # Soft-deleted products don't hold their name hostage: the pair only has
    # to stay unique among products that can still turn up on an invoice
    # line. Restoring one that now collides is what restore_product_details
    # re-checks, rather than blocking a live product here for a dead one.
    products_on_hsn_code = await ProductDetails.find(
        ProductDetails.hsn_code == hsn_code, ProductDetails.is_deleted == False
    ).to_list()
    incoming_name = _normalised_product_name(product_name)

    for existing_product in products_on_hsn_code:
        if existing_product.id == exclude_id:
            continue
        if _normalised_product_name(existing_product.product_name) == incoming_name:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="a product with this name already exists under this hsn code",
            )


async def _replace_image_paths(product_id: int, image_paths: list[str]) -> None:
    await ProductImageDetails.find(ProductImageDetails.product_id == product_id).delete()
    for image_path in image_paths:
        image_id = await get_next_id(ProductImageIdCounter, "next_product_image_id", ProductImageDetails)
        await ProductImageDetails(id=image_id, product_id=product_id, image_path=image_path).insert()


@router.post("/upload_product_image", response_model=UploadProductImageResponse)
async def upload_product_image(
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> UploadProductImageResponse:
    # No disk write here — just reads the bytes back so the frontend can
    # preview and, on Save, upload the same file again via add_product_image
    # once the product actually exists.
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

    await _replace_image_paths(product_id, payload.image_paths)

    return AddProductDetailsResponse(message="product added successfully", id=product_id, image_paths=payload.image_paths)


@router.get("/get_product_details", response_model=list[ProductDetailItem])
async def get_product_details(
    _: User | None = Depends(require_admin),
) -> list[ProductDetailItem]:
    # Deliberately unfiltered — hidden AND soft-deleted products come back
    # too, each carrying its flags. The admin UI splits them into its
    # Active/Hidden/Deleted tabs itself (products-page-client.tsx), and the
    # order/quotation/invoice tables need the deleted ones present to resolve
    # a product name for line items that reference them.
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
            is_deleted=product.is_deleted,
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

    await _replace_image_paths(product.id, payload.image_paths)

    return UpdateProductDetailsResponse(message="product updated successfully", id=product.id, image_paths=payload.image_paths)


# Every collection whose rows pin a product in place: as long as one of these
# still references it, the product's name and HSN code are what an existing
# order/quotation/invoice line renders, so the row can't actually go away.
# Deliberately not listed here:
#   - inventory / inventory_history, which only ever gain rows through a
#     purchase or sales order, so purchase_summary/sales_summary already
#     cover them;
#   - sales_order_costing, likewise derived from a sales order;
#   - product_inquiry, which snapshots the product name and unit price at
#     submission time precisely so an inquiry keeps rendering after the
#     product is gone (see models/product_inquiry.py).
# Each entry pairs the collection with the attribute naming its parent
# document, so one order listing the same product on two lines still counts
# once.
_PRODUCT_REFERENCES = (
    (SalesSummary, "sales_order_id", "sales order"),
    (QuotationSummary, "quotation_id", "quotation"),
    (ProformaInvoiceSummary, "invoice_id", "proforma invoice"),
    (PurchaseSummary, "purchase_order_id", "purchase order"),
)


def _phrase_reference_counts(counts: list[tuple[int, str]]) -> list[str]:
    # [(2, "sales order"), (0, "quotation"), (1, "purchase order")]
    #   -> ["2 sales orders", "1 purchase order"]
    # Zero-count entries drop out entirely rather than reading as "0
    # quotations" in the middle of the refusal message.
    return [f"{count} {noun}{'s' if count != 1 else ''}" for count, noun in counts if count]


async def _describe_product_references(product_id: int) -> list[str]:
    # Counted per parent document rather than per line, since one order
    # listing the same product twice is still just the one order the admin
    # would have to go and edit.
    counts: list[tuple[int, str]] = []
    for model, parent_attribute, noun in _PRODUCT_REFERENCES:
        rows = await model.find(model.product_id == product_id).to_list()
        counts.append((len({getattr(row, parent_attribute) for row in rows}), noun))
    return _phrase_reference_counts(counts)


@router.post("/delete_product_details", response_model=DeleteProductDetailsResponse)
async def delete_product_details(
    payload: DeleteProductDetailsRequest,
    _: User | None = Depends(require_admin),
) -> DeleteProductDetailsResponse:
    # Two very different actions behind one endpoint, matching the two options
    # the admin picks between in the delete popup (product-form-modal.tsx):
    #   permanent=False -> is_deleted flag only, fully reversible via
    #                      restore_product_details, images untouched.
    #   permanent=True  -> the product row, its product_image_details rows and
    #                      the image files on disk are all removed, and
    #                      there's no undo — hence the reference check first.
    product = await ProductDetails.get(payload.product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    if not payload.permanent:
        product.is_deleted = True
        await product.save()
        return DeleteProductDetailsResponse(message="product deleted successfully")

    references = await _describe_product_references(product.id)
    if references:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"this product is used by {', '.join(references)} and can't be permanently deleted — "
                "delete it temporarily instead"
            ),
        )

    # Images go before the product itself: if removing a file throws, the
    # product is still there to try again from, rather than orphaning both the
    # rows and the files behind a product that no longer exists.
    images = await ProductImageDetails.find(ProductImageDetails.product_id == product.id).to_list()
    for image in images:
        remove_stored_image(image.image_path)
    await ProductImageDetails.find(ProductImageDetails.product_id == product.id).delete()

    await product.delete()

    return DeleteProductDetailsResponse(message="product permanently deleted")


@router.post("/restore_product_details", response_model=RestoreProductDetailsResponse)
async def restore_product_details(
    payload: RestoreProductDetailsRequest,
    _: User | None = Depends(require_admin),
) -> RestoreProductDetailsResponse:
    product = await ProductDetails.get(payload.product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    # The HSN code + name pair only has to be unique among live products (see
    # _validate_hsn_code_product_name), so a product added while this one was
    # deleted may have taken its pair in the meantime — bringing it back has
    # to re-check, or two live products would end up indistinguishable on an
    # invoice line.
    await _validate_hsn_code_product_name(product.hsn_code, product.product_name, exclude_id=product.id)

    product.is_deleted = False
    await product.save()

    return RestoreProductDetailsResponse(message="product restored successfully")


@router.post("/add_product_image", response_model=AddProductImageResponse)
async def add_product_image(
    product_id: int = Form(...),
    file: UploadFile = File(...),
    _: User | None = Depends(require_admin),
) -> AddProductImageResponse:
    # Persists one image for an already-saved product — see the module
    # docstring above for why this is a separate, per-image call rather than
    # bundled into add/update_product_details.
    product = await ProductDetails.get(product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    image_bytes = await file.read()
    try:
        image_path = store_product_image(image_bytes, file.filename or "image")
    except LocalUploadBlockedError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))

    image_id = await get_next_id(ProductImageIdCounter, "next_product_image_id", ProductImageDetails)
    await ProductImageDetails(id=image_id, product_id=product_id, image_path=image_path).insert()

    return AddProductImageResponse(message="image added successfully", image_path=image_path)


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
    products = await ProductDetails.find(
        ProductDetails.is_visible == True, ProductDetails.is_deleted == False
    ).to_list()
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
