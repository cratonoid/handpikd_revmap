# Schema for the #sales_order_costing collection: the cost-side breakdown
# behind a sales order's line items, entered from the "Add details" page
# (frontend/src/app/admin/orders/sales/[id]/details/page.tsx).
#
# One row per #sales_summary LINE, keyed by sales_summary_id. A sales order
# can legitimately list the same product on two lines at different rates
# (bought in two lots, sold at two prices), and each of those lines has to
# be costed on its own — so the product id alone is not enough to hang
# costing off. update_sales_order_details keeps #sales_summary ids stable
# across an edit (rows are updated in place, not deleted and reinserted)
# precisely so this key survives.
#
# Rows written before this key existed have sales_summary_id = None and are
# keyed by product_id alone ("legacy" rows below). They still read back — the
# sheet shows them as the default for every line of that product — and the
# first save of the sheet claims one for a specific line and inserts fresh
# rows for the rest, so no migration is needed.
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
    # FK -> SalesSummary.id: the one line this row costs. None only on rows
    # written before costing was keyed per line (see the header comment),
    # which apply to every line of `product_id` until the sheet is re-saved.
    sales_summary_id: int | None = None
    # Kept alongside sales_summary_id (rather than looked up through it) so
    # the accounts P&L can still cost a legacy row, and so a row is readable
    # on its own.
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
