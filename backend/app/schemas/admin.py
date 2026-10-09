# Request/response bodies for the admin module's customer details endpoints.
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from app.models import PointsSource


class AddCustomerDetailsRequest(BaseModel):
    mail: str
    password: str
    registered_name: str
    company_or_department: str
    address: str
    # Optional — not every client is GST-registered. Blank is a supported
    # value all the way down: is_intra_state in services/gst.py reads a
    # missing buyer GSTIN as inter-state (IGST), and the invoice PDF renders
    # an empty Place of Supply rather than failing.
    company_gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from company_gst" — the route calls
    # resolve_state_code before storing, so a client whose GSTIN is on file
    # never has to have their state keyed in separately. state_name is
    # always re-derived from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    # Starting points, granted as the client's first points lot. 0 grants
    # nothing.
    points: int = Field(default=0, ge=0)
    # When those starting points expire. Blank means the standard three
    # weeks from today (services/customer_points.py's default_expiry).
    points_expires_on: date | None = None
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "AddCustomerDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class AddCustomerDetailsResponse(BaseModel):
    message: str
    # The new CustomerDetails.id, so the client form can manage the new
    # client's points without reloading the table first.
    customer_id: int | None = None


class CustomerDetailItem(BaseModel):
    # The CustomerDetails.id — what the points endpoints below are keyed on.
    customer_id: int
    mail: str
    password: str
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str = ""
    state_code: str = ""
    state_name: str = ""
    # The client's live points balance: unspent points on lots that haven't
    # expired or been revoked. Read-only — points are added and withdrawn
    # through the points endpoints, not by editing this figure.
    points: int
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]


class UpdateCustomerDetailsRequest(BaseModel):
    # The customer being edited, identified by their CURRENT email — it is
    # the only handle the frontend has (CustomerDetailItem exposes no id).
    mail: str
    # The address to rename that login to. Empty (or identical to `mail`)
    # means "leave the email alone"; anything else is only accepted if no
    # other user already holds it — see update_customer_details in
    # routes/admin.py.
    new_mail: str = ""
    # Empty string means "leave the current password unchanged" — see
    # update_customer_details in routes/admin.py.
    password: str = ""
    registered_name: str
    company_or_department: str
    address: str
    company_gst: str = ""
    # Two-digit GST state code (see services/gst.py's GST_STATE_CODES) and
    # its name. Blank means "derive it from company_gst" — the route calls
    # resolve_state_code before storing, so a client whose GSTIN is on file
    # never has to have their state keyed in separately. state_name is
    # always re-derived from the code rather than trusted.
    state_code: str = ""
    state_name: str = ""
    # No points field: the balance is the sum of the client's points lots,
    # changed only through add_customer_points/revoke_customer_points_lot.
    is_deleted: bool = False
    contact_name: list[str]
    contact_phone: list[str]

    @model_validator(mode="after")
    def _check_contacts_match(self) -> "UpdateCustomerDetailsRequest":
        if len(self.contact_name) != len(self.contact_phone):
            raise ValueError("contact_name and contact_phone must have the same number of entries")
        if len(self.contact_name) == 0:
            raise ValueError("at least one contact is required")
        return self


class UpdateCustomerDetailsResponse(BaseModel):
    message: str


class CustomerListItem(BaseModel):
    # Lightweight id+name shape for customer-picker dropdowns (the sales
    # order popup) — unlike get_vendors_list/VendorListItem, this returns
    # EVERY customer (active and deleted), since CustomerDetailItem above has
    # no numeric id at all and this is the only place the frontend can
    # resolve a sales order's cust_id back to a name.
    customer_id: int
    customer_name: str
    # Carried alongside the name because one registered name can cover
    # several departments, which the name alone doesn't distinguish in the
    # sales order form's customer picker. Defaulted since it's free text and
    # may be blank on older clients.
    company_or_department: str = ""
    is_deleted: bool


class CustomerPointsLotItem(BaseModel):
    id: int
    points: int
    used: int
    # What's left of the lot, whether or not it still counts — see status.
    remaining: int
    expires_on: date
    created_at: datetime
    source: PointsSource
    invoice_id: int | None = None
    note: str = ""
    # "active" (counts towards the balance), "expired" (its expiry date has
    # been reached), "revoked" (withdrawn) or "used" (fully spent).
    status: str


class CustomerPointsResponse(BaseModel):
    cust_id: int
    available_points: int
    # Points the sales order passed as ?sales_order_id= already holds from
    # this client — on top of available_points when that order is re-saved,
    # since they go back into the pot first. 0 without the parameter, or
    # when the order belongs to another client.
    order_held_points: int = 0
    lots: list[CustomerPointsLotItem]


class AddCustomerPointsRequest(BaseModel):
    cust_id: int
    points: int = Field(gt=0)
    # Blank means the standard three weeks from today.
    expires_on: date | None = None
    note: str = ""


class AddCustomerPointsResponse(BaseModel):
    message: str


class RevokeCustomerPointsLotRequest(BaseModel):
    lot_id: int


class RevokeCustomerPointsLotResponse(BaseModel):
    message: str
