# Categories module: endpoints for managing the category tree, restricted to
# admins (bypassed entirely when settings.auth_enabled is False, matching
# require_admin in routes/admin.py).
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.routes.admin import require_admin
from app.models import Category, CategoryIdCounter, ProductDetails, User
from app.schemas.categories import (
    AddCategoryRequest,
    AddCategoryResponse,
    CategoryItem,
    UpdateCategoryRequest,
    UpdateCategoryResponse,
)
from app.services.counters import get_next_id

router = APIRouter(prefix="/admin/categories", tags=["categories"])


@router.get("/get_categories", response_model=list[CategoryItem])
async def get_categories(
    _: User | None = Depends(require_admin),
) -> list[CategoryItem]:
    categories = await Category.find_all().to_list()
    return [
        CategoryItem(
            category_id=category.id,
            category_name=category.category_name,
            parent_id=category.parent_id,
        )
        for category in categories
    ]


@router.post("/add_category", response_model=AddCategoryResponse)
async def add_category(
    payload: AddCategoryRequest,
    _: User | None = Depends(require_admin),
) -> AddCategoryResponse:
    parent = None
    if payload.parent_id is not None:
        parent = await Category.get(payload.parent_id)
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="parent category not found")

    category_id = await get_next_id(CategoryIdCounter, "next_category_id", Category)
    category = Category(
        id=category_id,
        category_name=payload.category_name,
        parent_id=payload.parent_id,
        is_parent=False,
    )
    await category.insert()

    # The parent now has at least one child, so flag it as a parent category.
    if parent is not None and not parent.is_parent:
        parent.is_parent = True
        await parent.save()

    return AddCategoryResponse(message="category added successfully")


@router.post("/update_category", response_model=UpdateCategoryResponse)
async def update_category(
    payload: UpdateCategoryRequest,
    _: User | None = Depends(require_admin),
) -> UpdateCategoryResponse:
    if not payload.delete:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no changes specified")

    category = await Category.get(payload.category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="category not found")

    child = await Category.find_one(Category.parent_id == category.id)
    if child is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="category has child categories")

    product = await ProductDetails.find_one(ProductDetails.category_ids == category.id)
    if product is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="category has products")

    await category.delete()

    # If that was the parent's last remaining child, it's no longer a parent.
    if category.parent_id is not None:
        sibling = await Category.find_one(Category.parent_id == category.parent_id)
        if sibling is None:
            parent = await Category.get(category.parent_id)
            if parent is not None and parent.is_parent:
                parent.is_parent = False
                await parent.save()

    return UpdateCategoryResponse(message="category deleted successfully")
