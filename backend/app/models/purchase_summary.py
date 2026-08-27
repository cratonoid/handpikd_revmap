# Schema for the #purchase_summary collection.
from beanie import Document


class PurchaseSummary(Document):
    id: int
    purchase_order_id: int  # FK -> PurchaseOrders.id
    product_id: int  # FK -> ProductDetails.id
    quantity: int
    rate: float
    # This line's GST rate, and the source of truth for it: a vendor invoice
    # routinely taxes its lines at different rates (paper board at 5%
    # alongside toiletries at 18% on one Hello Pen Mart bill), which a single
    # header-level rate on PurchaseOrders could only have represented by
    # blending — putting the wrong tax on every line. PurchaseOrders still
    # says which HEADS the rate falls under (its tax_kind), since that's
    # decided by the two parties' states rather than by the goods.
    #
    # Defaulted for rows written before this field existed; those are
    # backfilled from their order's header rate by
    # _backfill_purchase_summary_gst in core/db.py.
    gst_perc: float = 0.0

    class Settings:
        name = "purchase_summary"
