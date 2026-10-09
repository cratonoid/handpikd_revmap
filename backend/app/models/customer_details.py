# Schema for the #customer_details collection.
from beanie import Document


class CustomerDetails(Document):
    id: int
    user_id: int  # FK -> User.id
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str
    # The state this client is registered/located in, as a two-digit GST
    # state code plus its name. Auto-filled from company_gst's first two
    # digits by the add/edit endpoints when it's left blank, but stored in
    # its own right so a client with no GSTIN still has a state: a same-state
    # supply is CGST+SGST even when the buyer is unregistered. "" only for
    # clients created before this field existed and never edited since —
    # services/gst.py's resolve_state_code falls back to the GSTIN for those.
    state_code: str = ""
    state_name: str = ""
    # Legacy: the client's points before they were held as expiring lots in
    # #customer_points_lot. No longer read or written — any balance left
    # here is moved into an opening-balance lot at startup and zeroed (see
    # _backfill_customer_points_lots in core/db.py). The live balance is
    # services/customer_points.py's available_points.
    points: int = 0
    is_deleted: bool = False

    class Settings:
        name = "customer_details"
