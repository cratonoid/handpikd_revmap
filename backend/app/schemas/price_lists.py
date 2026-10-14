# Request/response bodies for the price lists module's endpoints. Add and
# update take multipart form fields (they carry the PDF), so only the JSON
# bodies and responses live here.
from datetime import datetime

from pydantic import BaseModel


class PriceListDetailItem(BaseModel):
    id: int
    price_list_name: str
    vendor_id: int
    catalogue_id: int | None
    notes: str
    file_type: str  # "pdf" | "xlsx" | "xls"
    original_filename: str
    uploaded_at: datetime


class SavePriceListResponse(BaseModel):
    message: str
    id: int


class DeletePriceListRequest(BaseModel):
    id: int


class DeletePriceListResponse(BaseModel):
    message: str


# Catalogue picker options for the price list form. Served from this module,
# not get_catalogue_details, so a role with Price Lists but not Catalogues
# can still link one.
class PriceListCatalogueOption(BaseModel):
    id: int
    catalogue_name: str
    vendor_id: int
