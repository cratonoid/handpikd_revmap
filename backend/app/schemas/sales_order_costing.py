# Request/response bodies for the sales order costing ("Add details") screen.
#
# One entry per #sales_summary row (line item) on the sales order, keyed by
# line_item_id — see app/models/sales_order_costing.py. The same product on
# two lines gets two entries, each costed on its own.
from datetime import datetime

from pydantic import BaseModel, model_validator


class PrintingCostItem(BaseModel):
    printing_type: str
    # Per piece.
    cost_per_unit: float
    is_taxable: bool = False
    tax_perc: float = 0.0


class SalesOrderCostingLine(BaseModel):
    # SalesSummary.id — the key a save is matched back on.
    line_item_id: int
    product_id: int
    # ProductDetails.product_name, shown on the sheet as "Model Name".
    model_name: str
    # This line's own quantity (SalesSummary.quantity).
    quantity: int
    # --- cost side (from #sales_order_costing, defaulted on first open) ---
    net_purchase_rate: float
    purchase_tax_perc: float
    printing_costs: list[PrintingCostItem]
    delivery: float
    miscellaneous: float
    # --- sales side ------------------------------------------------------
    # net_sales_rate/sales_tax_perc are the live SalesSummary.rate /
    # SalesSummary.tax_perc, so editing them here moves the order's own
    # totals. discount has no #sales_summary column and lives in
    # #sales_order_costing.
    net_sales_rate: float
    discount: float
    sales_tax_perc: float
    # False until the admin saves this sheet for the first time — the inputs
    # above are then defaults pulled from the product master rather than
    # stored figures.
    is_saved: bool


class SalesOrderCostingResponse(BaseModel):
    sales_order_id: int
    order_no: int
    customer_name: str
    date: datetime
    order_status_name: str
    # The order's own discount off its whole net amount
    # (SalesOrders.overall_discount). Read-only here — it is entered on the
    # order form, not on this sheet — but the sheet's footer totals have to
    # subtract it or they would disagree with the order's headline figures.
    overall_discount: float
    # Likewise read-only here and likewise entered on the order form (see
    # SalesOrders.delivery_charge): billed on top of the line items, so this
    # sheet's footer has to add it or it would understate the order's own
    # Before tax / After tax figures.
    delivery_charge: float
    delivery_tax_perc: float
    lines: list[SalesOrderCostingLine]


class UpdateSalesOrderCostingLine(BaseModel):
    line_item_id: int
    net_purchase_rate: float
    purchase_tax_perc: float
    printing_costs: list[PrintingCostItem] = []
    delivery: float = 0.0
    miscellaneous: float = 0.0
    net_sales_rate: float
    discount: float = 0.0
    sales_tax_perc: float


class UpdateSalesOrderCostingRequest(BaseModel):
    sales_order_id: int
    lines: list[UpdateSalesOrderCostingLine]

    @model_validator(mode="after")
    def _check_line_items_unique(self) -> "UpdateSalesOrderCostingRequest":
        line_item_ids = [line.line_item_id for line in self.lines]
        if len(line_item_ids) != len(set(line_item_ids)):
            raise ValueError("each line item may only appear once — costing rows are keyed by line item")
        return self


class UpdateSalesOrderCostingResponse(BaseModel):
    message: str
