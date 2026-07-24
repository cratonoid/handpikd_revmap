# Schema for the #category collection.
from pydantic import BaseModel


class Category(BaseModel):
    id: int
    category_name: str
    parent_id: int | None = None  # FK -> Category.id (self-referencing)
    is_parent: bool
