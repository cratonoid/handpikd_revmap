// ---------------------------------------------------------------------------
// Sales order costing report — the "Costing" view on the Sales orders tab
// ---------------------------------------------------------------------------
// One row per product per order, cost side only, from
// GET /admin/get_sales_order_costing_report (backend/app/api/routes/
// sales_orders.py, _build_costing_report_rows). All the arithmetic happens
// server-side; this file only reshapes the response.
import { apiFetch } from "@/lib/api";

export type CostingReportPrinting = {
  printingType: string;
  cost: number;
  tax: number;
};

export type CostingReportRow = {
  salesOrderId: number;
  orderNo: number;
  orderStatusId: number;
  custId: number;
  date: string;
  productId: number;
  productName: string;
  quantity: number;
  purchaseCost: number;
  purchaseTax: number;
  printingCosts: CostingReportPrinting[];
  delivery: number;
  miscellaneous: number;
  // Purchase + printing + delivery + misc, taxes excluded — the sheet's
  // "Net final cost".
  totalCost: number;
  // False when a line in the row has no saved "Add details" costing and is
  // shown at the product master's default rates.
  isCosted: boolean;
};

type CostingReportRowResponse = {
  sales_order_id: number;
  order_no: number;
  order_status_id: number;
  cust_id: number;
  date: string;
  product_id: number;
  product_name: string;
  quantity: number;
  purchase_cost: number;
  purchase_tax: number;
  printing_costs: { printing_type: string; cost: number; tax: number }[];
  delivery: number;
  miscellaneous: number;
  total_cost: number;
  is_costed: boolean;
};

export async function fetchSalesOrderCostingReport(): Promise<CostingReportRow[]> {
  const response = await apiFetch("/admin/get_sales_order_costing_report");
  if (!response.ok) {
    throw new Error(`Failed to load the costing report (HTTP ${response.status})`);
  }

  const rows: CostingReportRowResponse[] = await response.json();
  return rows.map((row) => ({
    salesOrderId: row.sales_order_id,
    orderNo: row.order_no,
    orderStatusId: row.order_status_id,
    custId: row.cust_id,
    date: row.date,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    purchaseCost: row.purchase_cost,
    purchaseTax: row.purchase_tax,
    printingCosts: row.printing_costs.map((printing) => ({
      printingType: printing.printing_type,
      cost: printing.cost,
      tax: printing.tax,
    })),
    delivery: row.delivery,
    miscellaneous: row.miscellaneous,
    totalCost: row.total_cost,
    isCosted: row.is_costed,
  }));
}
