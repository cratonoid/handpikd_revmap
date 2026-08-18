# Schema for the #sales_order_costing collection: the cost-side breakdown
# behind a sales order's line items, entered from the "Add details" page
# (frontend/src/app/admin/orders/sales/[id]/details/page.tsx).
#
# One row per (sales_order_id, product_id) — NOT per #sales_summary row. A
# sales order can legitimately list the same product on two lines, and
# update_sales_order_details deletes and reinserts every #sales_summary row
# on each save (new ids each time), so the product id is the only identifier
# stable enough to hang costing off. The details page therefore shows one
# costing row per distinct product, with the quantities of that product's
# lines summed.
#
# Only INPUTS live here. Everything the details page displays alongside them
# (gross rates, tax amounts, net final cost, profit) is derived on the fly —
# frontend/src/lib/sales-order-costing.ts holds those formulas, computed
# client-side so the page recalculates as the admin types.
#
# The sales-side rate and tax % are deliberately absent: those are the
# existing SalesSummary.rate / SalesSummary.tax_perc fields, which the
# details page edits directly so the order's own totals stay in sync. Only
# `discount` is sales-side and stored here, because #sales_summary has no
# column for it.
from beanie import Document
from pydantic import BaseModel


class PrintingCost(BaseModel):
    # Free text rather than an enum — "Laser", "UV", "Screen" are the common
    # ones but the admin can name any process.
    printing_type: str
    # Per PIECE, unlike delivery/miscellaneous below which are flat figures
    # for the whole line.
    cost_per_unit: float
    is_taxable: bool = False
    # Only meaningful when is_taxable; kept at 0.0 otherwise.
    tax_perc: float = 0.0


class SalesOrderCosting(Document):
    id: int
    sales_order_id: int  # FK -> SalesOrders.id
    product_id: int  # FK -> ProductDetails.id
    # Defaulted from ProductDetails.vendor_rate the first time the details
    # page is opened, then editable and stored independently — a later change
    # to the product master must not silently rewrite a costed order.
    net_purchase_rate: float
    purchase_tax_perc: float = 0.0
    printing_costs: list[PrintingCost] = []
    # Flat amounts for the whole line, not per piece.
    delivery: float = 0.0
    miscellaneous: float = 0.0
    # Absolute amount taken off this line's net sales price (not a
    # percentage, not per piece).
    discount: float = 0.0

    class Settings:
        name = "sales_order_costing"
