# Schema for the #catalogue_details collection.
from beanie import Document


class CatalogueDetails(Document):
    id: int
    catalogue_name: str
    catalogue_vendor_id: int  # FK -> VendorDetails.id
    catalogue_type: str  # "brand" | "regular"
    category_id: int  # FK -> Category.id (a top-level/root category only)

    class Settings:
        name = "catalogue_details"
