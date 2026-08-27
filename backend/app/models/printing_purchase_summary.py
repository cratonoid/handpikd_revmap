# Schema for the #printing_purchase_summary collection: one row per line item
# on a printing purchase order.
#
# The counterpart of PurchaseSummary, and the reason printing has its own
# collections at all: there is no product_id here. A printing vendor bills a
# service against a description they wrote themselves ("Customized Print
# Service", "Sticker Printing A3 UV / Christ Logo Laptop Bag"), which matches
# nothing in our catalogue and is not supposed to — so the description is
# stored verbatim, as printed, and nothing about this row can move stock or
# touch a product.
from beanie import Document


class PrintingPurchaseSummary(Document):
    id: int
    printing_purchase_order_id: int  # FK -> PrintingPurchaseOrders.id
    # The service as the vendor described it. Free text and authoritative:
    # this IS the line item, where a material line only points at one.
    description: str
    # The SAC (services) or HSN (printed goods) code the vendor printed —
    # printing bills use both, e.g. 998912 for a print service and 3919 for
    # printed stickers billed as goods. "" when the invoice didn't print one.
    hsn_code: str = ""
    quantity: int
    rate: float
    # This line's own GST rate, the source of truth for it — same arrangement
    # as PurchaseSummary.gst_perc, since a printing bill can mix rates across
    # its lines just as a material one can.
    gst_perc: float = 0.0

    class Settings:
        name = "printing_purchase_summary"
