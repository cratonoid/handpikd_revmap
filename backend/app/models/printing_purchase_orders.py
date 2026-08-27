# Schema for the #printing_purchase_orders collection.
#
# The printing half of purchasing, kept in its own collection rather than as
# a type flag on PurchaseOrders. The two records differ in the one thing that
# matters most about a purchase order: a material order's line items are
# products, and creating one moves stock (see apply_purchase_order_stock in
# services/inventory.py). A printing order buys a SERVICE — "Customized Print
# Service", "Sticker Printing A3 UV" — which has no product behind it, no
# catalogue entry, and nothing to add to #inventory. Separating them means
# nothing on this side can reach the inventory or product code at all,
# instead of every write on the shared side having to remember to check a
# flag first.
#
# Everything about the GST arrangement is deliberately identical to
# PurchaseOrders, down to the field names, because it's the same tax on the
# same kind of bill — read that model's comments for why the rate lives on
# the line item and only the heads live here.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel

from app.services.gst import TaxKind


class PrintingPurchaseOrders(Document):
    id: int
    purchase_order_no: str
    vendor_id: int  # FK -> VendorDetails.id, always a vendor whose vendor_type is `printing`
    date: datetime  # Order date, set/edited by the admin via the form.
    total_amount_before_tax: float
    # Which GST heads this order is taxed under — CGST + SGST at half each
    # for an intra-state purchase, IGST alone for an inter-state one.
    # Defaulted from our state vs the vendor's (services/gst.py's
    # tax_kind_for) and overridable on the form, exactly as on the material
    # side. Never None here: unlike PurchaseOrders there are no rows
    # predating the field, so nothing needs backfilling.
    tax_kind: TaxKind
    # The order's single GST rate filed under the heads above — DERIVED from
    # the line items, and all None when they're taxed at different rates.
    # See PurchaseOrders.sgst_perc: nothing computes a total from these.
    sgst_perc: float | None = None
    cgst_perc: float | None = None
    igst_perc: float | None = None
    total_amount_after_tax: float
    description: str

    class Settings:
        name = "printing_purchase_orders"
        # Same database-level uniqueness as PurchaseOrders, and for the same
        # reason: the read-then-write checks in the routes can both pass when
        # two saves race, and an uploaded invoice takes its own number as the
        # order number, so this is also the last line of the duplicate-upload
        # defence.
        #
        # Its own collection means a printing order and a material order may
        # legitimately share a number — they're documents from different
        # vendors in different series, and nothing joins the two.
        indexes = [
            IndexModel("purchase_order_no", unique=True, name="printing_purchase_order_no_unique"),
        ]
