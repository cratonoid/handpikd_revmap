# Schema for the #purchase_orders collection.
from beanie import Document


class PurchaseOrders(Document):
    id: int
    purchase_order_no: str
    vendor_id: int  # FK -> VendorDetails.id
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
