# Schema for the #catalogue_details collection.
from beanie import Document


class CatalogueDetails(Document):
    id: int
    catalogue_name: str
    catalogue_vendor_id: int  # FK -> VendorDetails.id
    catalogue_type: str  # "brand" | "regular"
    # FK -> Category.id (array). Top-level/root categories only, and a
    # catalogue can sit under several of them at once — the storefront lists
    # it under each one (see get_public_catalogues). Was a single category_id
    # until catalogues that genuinely belong in more than one main category
    # had to be duplicated to appear in both; scripts/
    # migrate_catalogue_category_id_to_category_ids.py wraps the old scalar
    # into a one-element list.
    category_ids: list[int]
    # Storefront visibility only: an unticked catalogue disappears from the
    # public /brand-catalogues page but stays in /admin/catalogues, fully
    # editable, with all its pages intact. Catalogues have no soft delete,
    # so this is the way to take one off the site without losing it.
    #
    # Defaulted rather than required because catalogues predate the flag:
    # rows written before it exists have no is_visible field at all, and a
    # required field would fail to parse them. They read back as visible,
    # which is how they were behaving. get_public_catalogues matches this by
    # excluding only explicitly-false rows — see its query.
    is_visible: bool = True

    class Settings:
        name = "catalogue_details"
