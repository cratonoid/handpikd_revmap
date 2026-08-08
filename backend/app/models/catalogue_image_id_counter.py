# Schema for the #catalogue_image_id_counter collection. Single document
# (_id=1) that tracks the next auto-generated CatalogueImageDetails.id.
from beanie import Document


class CatalogueImageIdCounter(Document):
    id: int
    next_catalogue_image_id: int

    class Settings:
        name = "catalogue_image_id_counter"
