# Schema for the #price_list_id_counter collection. Single document (_id=1)
# that tracks the next auto-generated PriceListDetails.id.
from beanie import Document


class PriceListIdCounter(Document):
    id: int
    next_price_list_id: int

    class Settings:
        name = "price_list_id_counter"
