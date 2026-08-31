# Schema for the #unbilled_purchase_summary collection: one row per line item
# on an unbilled purchase order.
#
# Unlike PrintingPurchaseSummary — whose line IS its free-text description —
# this points at a real ProductDetails row, always one with is_unbilled True.
# The product is created inline by routes/unbilled_orders.py the first time a
# name is used, precisely so that everything downstream of the purchase
# (#inventory, #inventory_history, #sales_summary, costing, the invoice
# join) keeps working on a plain product_id and needs to know nothing about
# unbilled stock at all.
#
# There is no gst_perc here, and that is deliberate: see
# UnbilledPurchaseOrders on why no field on this side may read as tax.
from beanie import Document


class UnbilledPurchaseSummary(Document):
    id: int
    unbilled_purchase_order_id: int  # FK -> UnbilledPurchaseOrders.id
    product_id: int  # FK -> ProductDetails.id, always one whose is_unbilled is True
    quantity: int
    rate: float

    class Settings:
        name = "unbilled_purchase_summary"
