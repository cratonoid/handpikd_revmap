# Schema for the #sales_orders collection.
from datetime import datetime

from beanie import Document
from pydantic import BaseModel


class PointsAllocation(BaseModel):
    # How many of the order's redeemed points came out of which
    # CustomerPointsLot, so they can be handed back to the same lots when the
    # redemption is reduced or the order is deleted.
    lot_id: int  # FK -> CustomerPointsLot.id
    points: int


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
    # The client's loyalty points spent on this order, at one rupee each.
    # Applied exactly like overall_discount — the two are added together and
    # split across the line items before tax — but kept as a figure of its
    # own because, unlike a plain discount, it draws down the client's
    # balance (see services/customer_points.py). Capped at 5% of the order's
    # net subtotal when it is entered.
    points_redeemed: int = 0
    # Which point lots points_redeemed was taken from. Empty while the order
    # is soft-deleted: deleting an order hands its points back.
    points_allocations: list[PointsAllocation] = []
    # A delivery/freight charge billed TO the customer, on top of the line
    # items. Not to be confused with SalesOrderCosting.delivery, which is
    # what delivery COST us on a given product line and never reaches the
    # customer's document at all.
    #
    # Kept as its own figure rather than folded into a product's rate or
    # spread across the lines the way overall_discount is: freight is a
    # separate service supply, and burying it in a product's rate would
    # misstate that product's HSN-wise taxable value. The invoice prints it
    # as its own line under a SAC code (see routes/invoices.py).
    delivery_charge: float = 0.0
    # GST % charged on delivery_charge, stored per order rather than assumed
    # the same way each line item carries its own tax_perc — the rate that
    # applies depends on how the delivery was arranged. Left at 0 (and
    # meaningless) on an order with no delivery charge, which is also what
    # every order raised before this field existed reads as.
    delivery_tax_perc: float = 0.0
    # NOTE both totals below are INCLUSIVE of the delivery charge and its
    # tax: it is billed on the same invoice, so an order's headline figures
    # have to be what the customer actually owes.
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
