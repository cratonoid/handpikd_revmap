# Schema for the #purchase_orders collection.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel

from app.services.gst import TaxKind


class PurchaseOrders(Document):
    id: int
    purchase_order_no: str
    vendor_id: int  # FK -> VendorDetails.id
    date: datetime  # Order date, set/edited by the admin via the form.
    total_amount_before_tax: float
    # Which GST heads this order is taxed under — CGST + SGST at half each
    # for an intra-state purchase, IGST alone for an inter-state one. The
    # order form defaults it from our state vs the vendor's (see
    # services/gst.py's tax_kind_for) and the admin can override it, for the
    # cases the two states can't express.
    #
    # The RATE lives on each line item instead (PurchaseSummary.gst_perc),
    # because a vendor invoice routinely mixes rates across its lines and one
    # header-level rate could only have averaged them. This says how each
    # line's own rate is split across the heads.
    #
    # None on orders written before this field existed; those are backfilled
    # from the percentages below by _backfill_purchase_order_tax_kind in
    # core/db.py.
    tax_kind: TaxKind | None = None
    # The order's single GST rate, filed under the heads tax_kind names —
    # kept because it is what the purchase orders list, the edit form and the
    # accounts input-tax split have always read, and because most orders do
    # have exactly one rate.
    #
    # DERIVED, not authoritative: set from the line items when every one of
    # them is taxed at the same rate, and left None when they aren't, since
    # no single percentage is true of a mixed-rate order. Read
    # PurchaseSummary.gst_perc for the rate that actually applies to a line;
    # nothing computes a total from these (see _compute_totals in
    # routes/orders.py).
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_after_tax: float
    description: str

    class Settings:
        name = "purchase_orders"
        # Uniqueness enforced by the database, not only by the check in
        # create_new_purchase_order/update_purchase_order_details. Those
        # checks read before they write, so two saves racing each other can
        # both pass and both insert; this is what actually makes that
        # impossible. They stay because they're what turns a collision into a
        # sentence the admin can act on instead of a driver error.
        #
        # It also backs the duplicate-invoice rule: an uploaded invoice takes
        # its own number as the purchase order number, so a second upload of
        # the same document collides here even if nothing else caught it.
        indexes = [
            IndexModel("purchase_order_no", unique=True, name="purchase_order_no_unique"),
        ]
