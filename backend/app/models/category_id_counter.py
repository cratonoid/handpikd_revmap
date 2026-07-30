# Schema for the #category_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated Category.id.
from beanie import Document


class CategoryIdCounter(Document):
    id: int
    next_category_id: int

    class Settings:
        name = "category_id_counter"
