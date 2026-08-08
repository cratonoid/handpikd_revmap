# Schema for the #catalogue_image_details collection.
from beanie import Document


class CatalogueImageDetails(Document):
    id: int
    catalogue_id: int  # FK -> CatalogueDetails.id
    image_path: str

    class Settings:
        name = "catalogue_image_details"
