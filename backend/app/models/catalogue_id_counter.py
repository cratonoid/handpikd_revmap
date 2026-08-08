# Schema for the #catalogue_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated CatalogueDetails.id.
from beanie import Document


class CatalogueIdCounter(Document):
    id: int
    next_catalogue_id: int

    class Settings:
        name = "catalogue_id_counter"
