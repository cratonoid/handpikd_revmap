# Schema for the #category collection.
from beanie import Document


class Category(Document):
    id: int
    category_name: str
    parent_id: int | None = None  # FK -> Category.id (self-referencing)
    is_parent: bool

    class Settings:
        name = "category"
