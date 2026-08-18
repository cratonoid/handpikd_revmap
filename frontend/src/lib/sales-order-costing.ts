// ---------------------------------------------------------------------------
// Sales order costing — data + arithmetic for the "Add details" sheet
// ---------------------------------------------------------------------------
// Backs /admin/orders/sales/[id]/details. Fetches from
// GET /admin/get_sales_order_costing and saves through
// POST /admin/update_sales_order_costing (both in
// backend/app/api/routes/sales_orders.py).
//
// One row per DISTINCT product on the order, not per line item: costing is
// keyed by product id (see backend/app/models/sales_order_costing.py for
// why), so an order listing the same product twice shows it once here with
// the two lines' quantities summed.
//
// Which fields live where:
//   - Net Sales Rate / Sales Tax % ARE the line items' own
//     SalesSummary.rate / SalesSummary.tax_perc. Editing them here moves the
//     order's Before tax / Tax / After tax columns on the orders table —
//     that's deliberate, there is only one source of truth for them.
//   - Everything on the cost side, plus Discount (which #sales_summary has
//     no column for), lives in #sales_order_costing.
//
// computeCostingFigures below is the ONLY definition of the derived figures.
// It runs client-side on every keystroke so the sheet recalculates live; the
// backend independently re-derives just the order's headline totals on save
// (_compute_line_items_and_totals in routes/sales_orders.py), and the two
// agree because tax is charged on the discounted subtotal in both.
import { apiFetch } from "@/lib/api";

export type PrintingCost = {
  // Free text — "Laser", "UV" and "Screen" are the common ones but any
  // process can be named.
  printingType: string;
  // PER PIECE, unlike delivery/miscellaneous which are flat figures for the
  // whole line.
  costPerUnit: number;
  isTaxable: boolean;
  // Only meaningful when isTaxable.
  taxPerc: number;
};

export type CostingLine = {
  productId: number;
  // ProductDetails.product_name, shown on the sheet as "Model Name".
  modelName: string;
  // Summed across every line of this product on the order. Read-only here —
  // quantities are edited on the order form itself.
  quantity: number;
  netPurchaseRate: number;
  purchaseTaxPerc: number;
  printingCosts: PrintingCost[];
  delivery: number;
  miscellaneous: number;
  netSalesRate: number;
  discount: number;
  salesTaxPerc: number;
  // False until this sheet has been saved once — the values above are then
  // defaults seeded from the product master rather than stored figures.
  isSaved: boolean;
};

export type SalesOrderCosting = {
  salesOrderId: number;
  orderNo: number;
  customerName: string;
  date: string;
  orderStatusName: string;
  lines: CostingLine[];
};

// Shapes returned by the backend's SalesOrderCostingResponse schema.
type PrintingCostItem = {
  printing_type: string;
  cost_per_unit: number;
  is_taxable: boolean;
  tax_perc: number;
};

type SalesOrderCostingLineItem = {
  product_id: number;
  model_name: string;
  quantity: number;
  net_purchase_rate: number;
  purchase_tax_perc: number;
  printing_costs: PrintingCostItem[];
  delivery: number;
  miscellaneous: number;
  net_sales_rate: number;
  discount: number;
  sales_tax_perc: number;
  is_saved: boolean;
};

type SalesOrderCostingResponse = {
  sales_order_id: number;
  order_no: number;
  customer_name: string;
  date: string;
  order_status_name: string;
  lines: SalesOrderCostingLineItem[];
};

export async function fetchSalesOrderCosting(salesOrderId: number): Promise<SalesOrderCosting> {
  const response = await apiFetch(`/admin/get_sales_order_costing?sales_order_id=${salesOrderId}`);
  if (!response.ok) {
    // Surface the backend's own reason rather than a single catch-all
    // message — a 404 from a backend that predates this endpoint reads very
    // differently from a 404 on a genuinely deleted order, and the status
    // code is what tells them apart.
    const detail = await response.json().catch(() => null);
    throw new Error(
      typeof detail?.detail === "string"
        ? detail.detail
        : `Failed to load sales order details (HTTP ${response.status})`,
    );
  }

  const item: SalesOrderCostingResponse = await response.json();
  return {
    salesOrderId: item.sales_order_id,
    orderNo: item.order_no,
    customerName: item.customer_name,
    date: item.date,
    orderStatusName: item.order_status_name,
    lines: item.lines.map((line) => ({
      productId: line.product_id,
      modelName: line.model_name,
      quantity: line.quantity,
      netPurchaseRate: line.net_purchase_rate,
      purchaseTaxPerc: line.purchase_tax_perc,
      printingCosts: line.printing_costs.map((printing) => ({
        printingType: printing.printing_type,
        costPerUnit: printing.cost_per_unit,
        isTaxable: printing.is_taxable,
        taxPerc: printing.tax_perc,
      })),
      delivery: line.delivery,
      miscellaneous: line.miscellaneous,
      netSalesRate: line.net_sales_rate,
      discount: line.discount,
      salesTaxPerc: line.sales_tax_perc,
      isSaved: line.is_saved,
    })),
  };
}

// Every product on the order must be submitted together — the backend
// rejects a partial set, since saving one product's figures would leave the
// order's recomputed totals wrong for the rest.
export async function saveSalesOrderCosting(salesOrderId: number, lines: CostingLine[]): Promise<void> {
  const response = await apiFetch("/admin/update_sales_order_costing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sales_order_id: salesOrderId,
      lines: lines.map((line) => ({
        product_id: line.productId,
        net_purchase_rate: line.netPurchaseRate,
        purchase_tax_perc: line.purchaseTaxPerc,
        printing_costs: line.printingCosts.map((printing) => ({
          printing_type: printing.printingType,
          cost_per_unit: printing.costPerUnit,
          is_taxable: printing.isTaxable,
          tax_perc: printing.taxPerc,
        })),
        delivery: line.delivery,
        miscellaneous: line.miscellaneous,
        net_sales_rate: line.netSalesRate,
        discount: line.discount,
        sales_tax_perc: line.salesTaxPerc,
      })),
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : "Failed to save sales order details");
  }
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------
export type CostingFigures = {
  // Cost side
  netTotalCost: number;
  purchaseTaxRate: number;
  purchaseTaxAmount: number;
  grossPurchaseRate: number;
  grossPurchaseCost: number;
  netPrintingRate: number;
  netPrintingCost: number;
  printingTaxRate: number;
  printingTaxAmount: number;
  grossPrintingCost: number;
  netFinalCost: number;
  // Sales side
  netSalesPrice: number;
  netSubtotal: number;
  salesTaxRate: number;
  salesTaxAmount: number;
  grossSalesPrice: number;
  profit: number;
};

// Conventions baked in here, all confirmed with the admin:
//   - Printing costs are entered PER PIECE and scaled by quantity; delivery
//     and miscellaneous are flat amounts for the whole line.
//   - Discount is an absolute amount off the line — not a percentage, not
//     per piece.
//   - Purchase tax and printing tax are computed and shown, but stay OUT of
//     Net Final Cost and therefore out of Profit: they're treated as
//     reclaimable input credit rather than real cost.
export function computeCostingFigures(line: CostingLine): CostingFigures {
  const { quantity } = line;

  const netTotalCost = quantity * line.netPurchaseRate;
  const purchaseTaxRate = line.netPurchaseRate * (line.purchaseTaxPerc / 100);
  const purchaseTaxAmount = purchaseTaxRate * quantity;
  const grossPurchaseRate = line.netPurchaseRate + purchaseTaxRate;
  const grossPurchaseCost = grossPurchaseRate * quantity;

  // Summed per-piece across every printing type on the line. An untaxed
  // type contributes nothing to the tax rate whatever its taxPerc holds.
  const netPrintingRate = line.printingCosts.reduce((sum, printing) => sum + printing.costPerUnit, 0);
  const printingTaxRate = line.printingCosts.reduce(
    (sum, printing) => sum + (printing.isTaxable ? printing.costPerUnit * (printing.taxPerc / 100) : 0),
    0,
  );
  const netPrintingCost = netPrintingRate * quantity;
  const printingTaxAmount = printingTaxRate * quantity;

  const netFinalCost = netTotalCost + netPrintingCost + line.delivery + line.miscellaneous;

  const netSalesPrice = line.netSalesRate * quantity;
  const netSubtotal = netSalesPrice - line.discount;
  // Shown as a per-piece rate because that's how the admin reads the sheet;
  // guarded so a line whose quantity is zero doesn't divide by zero.
  const salesTaxRate = quantity ? (netSubtotal / quantity) * (line.salesTaxPerc / 100) : 0;
  const salesTaxAmount = salesTaxRate * quantity;

  return {
    netTotalCost,
    purchaseTaxRate,
    purchaseTaxAmount,
    grossPurchaseRate,
    grossPurchaseCost,
    netPrintingRate,
    netPrintingCost,
    printingTaxRate,
    printingTaxAmount,
    grossPrintingCost: netPrintingCost + printingTaxAmount,
    netFinalCost,
    netSalesPrice,
    netSubtotal,
    salesTaxRate,
    salesTaxAmount,
    grossSalesPrice: netSubtotal + salesTaxAmount,
    profit: netSubtotal - netFinalCost,
  };
}
