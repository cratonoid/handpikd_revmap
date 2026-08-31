# Schema for the #unbilled_purchase_orders collection.
#
# The third kind of purchase, alongside PurchaseOrders (material) and
# PrintingPurchaseOrders (printing), and it gets its own collection for the
# same reason printing does: what separates them is the document, not a
# filter over one list. An UNBILLED purchase is stock bought without a bill —
# cash at a local market, an odd-lot buy from a shop that raises no invoice —
# so there is no vendor invoice number to key it by, no GST charged on it, no
# input credit to reclaim, and no purchase invoice raised against it.
#
# Every GST field PurchaseOrders carries is absent here rather than zeroed.
# Zeroes would leave this collection one join away from the input-tax split
# in routes/accounts.py, which totals RECLAIMABLE credit — and an unbilled
# purchase has none. Nothing here can be mistaken for tax because there is no
# tax field to read.
#
# What it does share with the material side is stock: an unbilled purchase
# adds to #inventory exactly like a billed one, through the same
# services/inventory.py helpers, which is the whole reason for recording it.
# That is also the one way it differs from printing, whose line items are
# services and move no stock at all.
from datetime import datetime

from beanie import Document
from pymongo import IndexModel


class UnbilledPurchaseOrders(Document):
    id: int
    # "UPO-<id>", assigned by the backend off the same counter as `id` rather
    # than typed in. PurchaseOrders.purchase_order_no takes its value from
    # the vendor's own invoice number; there is no vendor document here to
    # take one from, so the series is ours and the admin never picks it.
    purchase_order_no: str
    # FK -> VendorDetails.id. No GSTIN requirement, unlike the billed side's
    # _require_vendor_has_gst — a vendor who raises no bill routinely has no
    # GST number on file, and VendorDetails already allows an empty `gst`.
    vendor_id: int
    date: datetime  # Purchase date, set/edited by the admin via the form.
    # One amount, not a before/after-tax pair: an unbilled purchase costs
    # what was paid.
    total_amount: float
    description: str

    class Settings:
        name = "unbilled_purchase_orders"
        # Same database-level uniqueness as the other two purchase
        # collections. The number is generated rather than entered, so this
        # guards against a counter reset or a hand-inserted row rather than
        # against admin error — cheap either way.
        indexes = [
            IndexModel("purchase_order_no", unique=True, name="unbilled_purchase_order_no_unique"),
        ]
