// ---------------------------------------------------------------------------
// Accounts — finance reporting data for /admin/accounts
// ---------------------------------------------------------------------------
// Three read-only endpoints in backend/app/api/routes/accounts.py, one per
// tab, each taking the same start_date/end_date pair the page's global range
// picker owns. They're separate calls rather than one fat payload so moving
// between tabs only fetches what that tab shows, and so a slow tab can't hold
// up the one the admin is actually looking at.
//
// Every figure here is DERIVED server-side — there is no accounts collection
// to write back to, which is why this module has fetchers but no savers.
//
// Money conventions, matching the backend:
//   - "revenue"/"taxable value" are NET of tax and net of discount.
//   - Percentages are whole numbers (12.5 means 12.5%).
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AccountsTrendPoint = {
  period: string; // "YYYY-MM"
  label: string; // "Jan 2026"
  revenue: number;
  cost: number;
  profit: number;
  invoiceCount: number;
};

export type AccountsTopClient = {
  custId: number;
  customerName: string;
  invoiceCount: number;
  revenue: number;
  cost: number;
  profit: number;
  // False when a sales order behind this client's invoices has no costing
  // entered — cost and profit are then understatements, not real figures.
  isFullyCosted: boolean;
};

export type AccountsOverview = {
  revenue: number;
  taxCollected: number;
  totalBilled: number;
  costOfGoods: number;
  grossProfit: number;
  grossMarginPerc: number;
  invoiceCount: number;
  averageInvoiceValue: number;
  salesOrdersInRange: number;
  salesOrdersCosted: number;
  trend: AccountsTrendPoint[];
  topClients: AccountsTopClient[];
};

export type ReceivableAgingBucket = {
  key: string;
  label: string;
  invoiceCount: number;
  amount: number;
};

export type ReceivableClient = {
  custId: number;
  customerName: string;
  invoiceCount: number;
  outstanding: number;
  overdue: number;
  oldestOverdueDays: number;
};

export type ReceivableInvoice = {
  id: number;
  invoiceNoDisplay: string;
  date: string;
  dueDate: string;
  customerName: string;
  amount: number;
  status: string;
  daysOverdue: number;
};

export type AccountsReceivables = {
  // The day aging was computed against — server "today", NOT the range end.
  asOf: string;
  totalOutstanding: number;
  overdueAmount: number;
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
  collectedInRange: number;
  paidInvoiceCount: number;
  averageDaysOverdue: number;
  aging: ReceivableAgingBucket[];
  clients: ReceivableClient[];
  invoices: ReceivableInvoice[];
};

export type TaxPeriod = {
  period: string;
  label: string;
  outputTax: number;
  inputTax: number;
  netLiability: number;
};

export type AccountsTaxSummary = {
  outputTax: number;
  outputTaxableValue: number;
  outputInvoiceCount: number;
  outputSgst: number;
  outputCgst: number;
  outputIgst: number;
  // Tax on invoices raised before the SGST/CGST/IGST split was stored on
  // them — real output tax, but with no head on record.
  outputUnclassified: number;
  inputTax: number;
  inputTaxableValue: number;
  inputInvoiceCount: number;
  inputSgst: number;
  inputCgst: number;
  inputIgst: number;
  inputUnclassified: number;
  netLiability: number;
  periods: TaxPeriod[];
};

// ---------------------------------------------------------------------------
// Wire shapes (snake_case, as returned by schemas/accounts.py)
// ---------------------------------------------------------------------------
type TrendPointResponse = {
  period: string;
  label: string;
  revenue: number;
  cost: number;
  profit: number;
  invoice_count: number;
};

type TopClientResponse = {
  cust_id: number;
  customer_name: string;
  invoice_count: number;
  revenue: number;
  cost: number;
  profit: number;
  is_fully_costed: boolean;
};

type OverviewResponse = {
  revenue: number;
  tax_collected: number;
  total_billed: number;
  cost_of_goods: number;
  gross_profit: number;
  gross_margin_perc: number;
  invoice_count: number;
  average_invoice_value: number;
  sales_orders_in_range: number;
  sales_orders_costed: number;
  trend: TrendPointResponse[];
  top_clients: TopClientResponse[];
};

type ReceivablesResponse = {
  as_of: string;
  total_outstanding: number;
  overdue_amount: number;
  outstanding_invoice_count: number;
  overdue_invoice_count: number;
  collected_in_range: number;
  paid_invoice_count: number;
  average_days_overdue: number;
  aging: { key: string; label: string; invoice_count: number; amount: number }[];
  clients: {
    cust_id: number;
    customer_name: string;
    invoice_count: number;
    outstanding: number;
    overdue: number;
    oldest_overdue_days: number;
  }[];
  invoices: {
    id: number;
    invoice_no_display: string;
    date: string;
    due_date: string;
    customer_name: string;
    amount: number;
    status: string;
    days_overdue: number;
  }[];
};

type TaxSummaryResponse = {
  output_tax: number;
  output_taxable_value: number;
  output_invoice_count: number;
  output_sgst: number;
  output_cgst: number;
  output_igst: number;
  output_unclassified: number;
  input_tax: number;
  input_taxable_value: number;
  input_invoice_count: number;
  input_sgst: number;
  input_cgst: number;
  input_igst: number;
  input_unclassified: number;
  net_liability: number;
  periods: { period: string; label: string; output_tax: number; input_tax: number; net_liability: number }[];
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
// Unlike lib/analytics.ts (whose dashboard cards silently fall back to "—"),
// these surface the backend's own detail message: a 400 from an inverted date
// range is something the admin can fix, and reads very differently from the
// backend being down.
async function readJson<T>(path: string, failureMessage: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      typeof detail?.detail === "string" ? detail.detail : `${failureMessage} (HTTP ${response.status})`,
    );
  }
  return response.json();
}

function rangeQuery(startDate: string, endDate: string): string {
  return `start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
}

export async function fetchAccountsOverview(startDate: string, endDate: string): Promise<AccountsOverview> {
  const item = await readJson<OverviewResponse>(
    `/admin/get_accounts_overview?${rangeQuery(startDate, endDate)}`,
    "Failed to load accounts overview",
  );
  return {
    revenue: item.revenue,
    taxCollected: item.tax_collected,
    totalBilled: item.total_billed,
    costOfGoods: item.cost_of_goods,
    grossProfit: item.gross_profit,
    grossMarginPerc: item.gross_margin_perc,
    invoiceCount: item.invoice_count,
    averageInvoiceValue: item.average_invoice_value,
    salesOrdersInRange: item.sales_orders_in_range,
    salesOrdersCosted: item.sales_orders_costed,
    trend: item.trend.map((point) => ({
      period: point.period,
      label: point.label,
      revenue: point.revenue,
      cost: point.cost,
      profit: point.profit,
      invoiceCount: point.invoice_count,
    })),
    topClients: item.top_clients.map((client) => ({
      custId: client.cust_id,
      customerName: client.customer_name,
      invoiceCount: client.invoice_count,
      revenue: client.revenue,
      cost: client.cost,
      profit: client.profit,
      isFullyCosted: client.is_fully_costed,
    })),
  };
}

export async function fetchAccountsReceivables(
  startDate: string,
  endDate: string,
): Promise<AccountsReceivables> {
  const item = await readJson<ReceivablesResponse>(
    `/admin/get_accounts_receivables?${rangeQuery(startDate, endDate)}`,
    "Failed to load receivables",
  );
  return {
    asOf: item.as_of,
    totalOutstanding: item.total_outstanding,
    overdueAmount: item.overdue_amount,
    outstandingInvoiceCount: item.outstanding_invoice_count,
    overdueInvoiceCount: item.overdue_invoice_count,
    collectedInRange: item.collected_in_range,
    paidInvoiceCount: item.paid_invoice_count,
    averageDaysOverdue: item.average_days_overdue,
    aging: item.aging.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      invoiceCount: bucket.invoice_count,
      amount: bucket.amount,
    })),
    clients: item.clients.map((client) => ({
      custId: client.cust_id,
      customerName: client.customer_name,
      invoiceCount: client.invoice_count,
      outstanding: client.outstanding,
      overdue: client.overdue,
      oldestOverdueDays: client.oldest_overdue_days,
    })),
    invoices: item.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNoDisplay: invoice.invoice_no_display,
      date: invoice.date,
      dueDate: invoice.due_date,
      customerName: invoice.customer_name,
      amount: invoice.amount,
      status: invoice.status,
      daysOverdue: invoice.days_overdue,
    })),
  };
}

export async function fetchAccountsTaxSummary(
  startDate: string,
  endDate: string,
): Promise<AccountsTaxSummary> {
  const item = await readJson<TaxSummaryResponse>(
    `/admin/get_accounts_tax_summary?${rangeQuery(startDate, endDate)}`,
    "Failed to load tax summary",
  );
  return {
    outputTax: item.output_tax,
    outputTaxableValue: item.output_taxable_value,
    outputInvoiceCount: item.output_invoice_count,
    outputSgst: item.output_sgst,
    outputCgst: item.output_cgst,
    outputIgst: item.output_igst,
    outputUnclassified: item.output_unclassified,
    inputTax: item.input_tax,
    inputTaxableValue: item.input_taxable_value,
    inputInvoiceCount: item.input_invoice_count,
    inputSgst: item.input_sgst,
    inputCgst: item.input_cgst,
    inputIgst: item.input_igst,
    inputUnclassified: item.input_unclassified,
    netLiability: item.net_liability,
    periods: item.periods.map((period) => ({
      period: period.period,
      label: period.label,
      outputTax: period.output_tax,
      inputTax: period.input_tax,
      netLiability: period.net_liability,
    })),
  };
}

// ---------------------------------------------------------------------------
// Date range presets
// ---------------------------------------------------------------------------
// The range lives in the page header and every tab reads it, so the preset
// arithmetic belongs here rather than in one tab's component.
//
// Indian financial year (1 April – 31 March) is used for the FY presets,
// since that's the year the GST figures on the tax tab are filed against.
export type DateRangePresetKey =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_fy"
  | "last_fy"
  | "custom";

export type DateRange = { startDate: string; endDate: string };

// Local-time YYYY-MM-DD. toISOString() is deliberately NOT used: it converts
// to UTC first, so for anyone east of Greenwich (IST included) an early-hours
// "today" would come back as yesterday's date.
export function toDateInputValue(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function financialYearStart(reference: Date): Date {
  // Before April the FY started in the PREVIOUS calendar year.
  const year = reference.getMonth() >= 3 ? reference.getFullYear() : reference.getFullYear() - 1;
  return new Date(year, 3, 1);
}

export function resolvePreset(key: Exclude<DateRangePresetKey, "custom">, today = new Date()): DateRange {
  switch (key) {
    case "this_month":
      return {
        startDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
        endDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case "last_month":
      return {
        startDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        endDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "this_quarter": {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      return {
        startDate: toDateInputValue(new Date(today.getFullYear(), quarterStartMonth, 1)),
        endDate: toDateInputValue(new Date(today.getFullYear(), quarterStartMonth + 3, 0)),
      };
    }
    case "this_fy": {
      const start = financialYearStart(today);
      return {
        startDate: toDateInputValue(start),
        // 31 March of the following calendar year — day 0 of April.
        endDate: toDateInputValue(new Date(start.getFullYear() + 1, 3, 0)),
      };
    }
    case "last_fy": {
      const start = financialYearStart(today);
      return {
        startDate: toDateInputValue(new Date(start.getFullYear() - 1, 3, 1)),
        endDate: toDateInputValue(new Date(start.getFullYear(), 3, 0)),
      };
    }
  }
}

export const DATE_RANGE_PRESETS: { key: Exclude<DateRangePresetKey, "custom">; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_fy", label: "This FY" },
  { key: "last_fy", label: "Last FY" },
];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
// Indian digit grouping (1,23,456 rather than 123,456) to match how the rest
// of the admin's money figures read on invoices and PDFs.
const CURRENCY_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const CURRENCY_FORMAT_EXACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return CURRENCY_FORMAT.format(value);
}

export function formatCurrencyExact(value: number): string {
  return CURRENCY_FORMAT_EXACT.format(value);
}

// Compact axis/label form — a chart axis has no room for "₹12,34,567".
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(value: string): string {
  // The backend sends plain YYYY-MM-DD date strings here (not timestamps),
  // so they're split by hand rather than passed through Date, which would
  // read them as UTC midnight and shift the day backwards in IST.
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
