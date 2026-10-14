# Schema for the #catalogue_image_details collection — one row per catalogue
# page, in page order (ascending id; see _replace_pages in
# routes/catalogues.py).
from beanie import Document


class CatalogueImageDetails(Document):
    id: int
    catalogue_id: int  # FK -> CatalogueDetails.id
    image_path: str
    # FK -> Category.id (array): which of the catalogue's own category_ids
    # this page is shown under on the storefront. Always a subset of them —
    # one catalogue can cover several categories and each gets only its own
    # pages, with a page free to appear under more than one. Empty means the
    # page is kept but shown nowhere.
    #
    # Defaulted so rows written before the field existed still parse;
    # scripts/migrate_catalogue_page_category_ids.py backfills those with all
    # of their catalogue's categories, which is how they were being shown.
    category_ids: list[int] = []

    class Settings:
        name = "catalogue_image_details"
