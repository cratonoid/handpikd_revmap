# Schema for the #sales_orders collection.
from datetime import datetime

from beanie import Document


class SalesOrders(Document):
    id: int
    order_no: int
    order_status_id: int  # FK -> OrderStatusMaster.id
    cust_id: int  # FK -> CustomerDetails.id
    date: datetime  # Order date, set/edited by the admin via the form.
    # A single discount off the whole order's net (pre-tax) amount, on top of
    # any per-product discount on the costing sheet (see
    # models/sales_order_costing.py). Stored as a flat rupee figure, never a
    # percentage. It is split across the order's line items in proportion to
    # their value before the totals below are computed
    # (_allocate_overall_discount in routes/sales_orders.py), so tax is
    # charged on the discounted subtotal and total_amount_before_tax is
    # already NET of it — nothing downstream (invoices, #sales_summary, the
    # costing sheet) has to subtract it again.
    overall_discount: float = 0.0
    total_amount_before_tax: float
    total_tax_amount: float
    total_amount_after_tax: float
    description: str
    related_purchase_order_ids: list[int] = []  # FK -> PurchaseOrders.id (array)
    # FK -> UnbilledPurchaseOrders.id (array). Separate from the list above
    # because the two are different collections with overlapping ids — see
    # InventoryHistory.unbilled_purchase_order_id for the same reasoning.
    # Editing an order on either list raises the one po_updated_flag below;
    # from the admin's side "a related purchase order changed, go and look"
    # is the same notice whichever kind it was.
    related_unbilled_purchase_order_ids: list[int] = []
    # Set whenever a related purchase order (see related_purchase_order_ids)
    # is edited after this sales order was created — a notice for the admin
    # to review, not an automatic data sync (the two orders' line
    # items/totals stay fully independent). Cleared the next time this sales
    # order itself is saved via update_sales_order_details, which counts as
    # the admin having reviewed it. See routes/orders.py's
    # update_purchase_order_details.
    po_updated_flag: bool = False
    is_deleted: bool = False

    class Settings:
        name = "sales_orders"
