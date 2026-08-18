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
    points: int
    is_deleted: bool = False

    class Settings:
        name = "customer_details"
