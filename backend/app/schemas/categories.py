# Request/response bodies for the categories module's endpoints.
from pydantic import BaseModel


class AddCategoryRequest(BaseModel):
    category_name: str
    parent_id: int | None = None


class AddCategoryResponse(BaseModel):
    message: str


class CategoryItem(BaseModel):
    category_id: int
    category_name: str
    parent_id: int | None = None


# Only supports deletion for now (see update_category in routes/categories.py);
# extend with optional category_name/parent_id fields if renaming/reparenting
# is needed later.
class UpdateCategoryRequest(BaseModel):
    category_id: int
    delete: bool = False


class UpdateCategoryResponse(BaseModel):
    message: str
