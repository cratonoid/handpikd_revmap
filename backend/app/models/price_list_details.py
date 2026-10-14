# Schema for the #price_list_details collection.
from datetime import datetime, timezone

from beanie import Document
from pydantic import Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PriceListDetails(Document):
    id: int
    price_list_name: str
    vendor_id: int  # FK -> VendorDetails.id
    # FK -> CatalogueDetails.id. Optional: a price list can stand on its own,
    # or point at the catalogue whose products it prices. Cleared (not left
    # dangling) when that catalogue is deleted — see delete_catalogue_details
    # in routes/catalogues.py.
    catalogue_id: int | None = None
    notes: str = ""
    # Key into the private PDF store (services/purchase_invoice_storage.py,
    # under its price_lists/ subfolder) — never a public /media path, since
    # vendor pricing is admin-only. Served through get_price_list_pdf.
    pdf_path: str
    # The file name the PDF was uploaded with, for display only.
    original_filename: str = ""
    # Naive UTC, like the other created_at fields; bumped whenever the PDF is
    # replaced, so the table shows how current the prices are.
    uploaded_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "price_list_details"
