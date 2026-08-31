# Schema for the #sales_orders collection.
from datetime import datetime

from beanie import Document


class SalesOrders(Document):
    id: int
    order_no: int
    order_status_id: int  # FK -> OrderStatusMaster.id
    cust_id: int  # FK -> CustomerDetails.id
    date: datetime  # Order date, set/edited by the admin via the form.
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
