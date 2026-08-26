# Schema for the #purchase_orders collection.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel


class PurchaseOrders(Document):
    id: int
    purchase_order_no: str
    vendor_id: int  # FK -> VendorDetails.id
    date: datetime  # Order date, set/edited by the admin via the form.
    total_amount_before_tax: float
    # Percentages (not rupee amounts) applied to total_amount_before_tax to
    # get total_amount_after_tax — see _compute_totals in routes/orders.py.
    # Indian GST rules mean a purchase is taxed as EITHER sgst_perc+cgst_perc
    # (intra-state) OR igst_perc alone (inter-state), never both — enforced
    # by CreateNewPurchaseOrderRequest/UpdatePurchaseOrderDetailsRequest in
    # schemas/purchase_orders.py.
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
