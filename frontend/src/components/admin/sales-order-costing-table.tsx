"use client";

// ---------------------------------------------------------------------------
// <SalesOrderCostingTable> — the "Detail" view on the Sales orders tab
// ---------------------------------------------------------------------------
// The cost side of every active sales order, one row per product per order:
// lines of the same product on one order are summed into a single row. The
// figures come pre-aggregated from GET /admin/get_sales_order_costing_report
// (lib/sales-order-costing-report.ts); nothing is computed here beyond
// picking the printing columns.
//
// Printing gets one column PER TYPE (Laser, UV, …) — whichever types appear
// in the rows currently shown — with their tax in a single column after
// them. Total cost excludes both taxes, as the "Add details" sheet's Net
// final cost does (the order total row matches that figure; a product row
// also leaves out delivery — see below).
//
// Delivery comes in two kinds, in two columns. "Uncharged" is what delivery
// cost us on a product, entered on the Add details sheet and never billed.
// "Charged" is the delivery billed to the customer, entered on the order
// form and invoiced as its own line — ONE figure for the whole order, so it
// shows on the order's first row only (and in its total row), and being
// income it stays out of Total cost.
//
// A product row's Total cost leaves out its uncharged delivery; that is
// counted only in the order's total row, which sums every column.
//
// Order no. and Product are both pinned, so they stay put while the cost
// columns scroll sideways.
//
// It shares the status pills, customer filter and order-no sort with the
// Brief view (sales-orders-tab.tsx owns that state), so switching views
// keeps the same slice of orders on screen. Re-fetched every time the view
// is opened, so edits made on a costing sheet show up straight away.
//
// A row with a line never costed on its sheet shows the product master's
// default purchase rate and GST (what the sheet pre-fills on first open)
// under a "Not costed" badge.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/icons";
import { ColumnFilterDropdown } from "@/components/admin/column-filter-dropdown";
import { fetchSalesOrderCostingReport, type CostingReportRow } from "@/lib/sales-order-costing-report";
import { byNewestFirst } from "@/lib/row-order";
import { formatDate } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";
type OrderNoSort = "asc" | "desc" | null;

type Props = {
  statusFilter: "all" | number;
  customerFilterIds: number[];
  onCustomerFilterChange: (ids: number[]) => void;
  customerFilterOptions: { value: number; label: string }[];
  customerName: (custId: number) => string | undefined;
  orderNoSort: OrderNoSort;
  onCycleOrderNoSort: () => void;
  // The "No ... sales orders" wording, shared with the Brief view.
  emptyMessage: string;
};

function formatAmount(value: number) {
  return `₹${value.toFixed(2)}`;
}

// Printing types are grouped case-insensitively, as the backend does within
// a row; a blank type still needs a header.
function printingKey(printingType: string) {
  return printingType.trim().toLowerCase();
}

function sumOf(rows: CostingReportRow[], pick: (row: CostingReportRow) => number) {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}

function printingTaxOf(row: CostingReportRow) {
  return row.printingCosts.reduce((sum, printing) => sum + printing.tax, 0);
}

function printingCostOf(row: CostingReportRow, key: string) {
  return row.printingCosts.find((printing) => printingKey(printing.printingType) === key)?.cost;
}

export function SalesOrderCostingTable({
  statusFilter,
  customerFilterIds,
  onCustomerFilterChange,
  customerFilterOptions,
  customerName,
  orderNoSort,
  onCycleOrderNoSort,
  emptyMessage,
}: Props) {
  const [rows, setRows] = useState<CostingReportRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetchSalesOrderCostingReport()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const customerFilterSet = new Set(customerFilterIds);
  const visibleRows = rows
    .filter((row) => statusFilter === "all" || row.orderStatusId === statusFilter)
    .filter((row) => customerFilterSet.size === 0 || customerFilterSet.has(row.custId))
    // byNewestFirst keys on {date, id}; rows of one order tie on both, and
    // the stable sort keeps them in the order's own line order.
    .sort(
      orderNoSort === null
        ? (a, b) => byNewestFirst({ date: a.date, id: a.salesOrderId }, { date: b.date, id: b.salesOrderId })
        : (a, b) => (orderNoSort === "asc" ? a.orderNo - b.orderNo : b.orderNo - a.orderNo),
    );

  // One column per printing type among the visible rows, A-Z, headed by the
  // first spelling seen.
  const printingColumns = new Map<string, string>();
  for (const row of visibleRows) {
    for (const printing of row.printingCosts) {
      const key = printingKey(printing.printingType);
      if (!printingColumns.has(key)) printingColumns.set(key, printing.printingType.trim() || "Unnamed");
    }
  }
  const printingColumnList = [...printingColumns].sort((a, b) => a[1].localeCompare(b[1]));

  // visibleRows split into one run per order. Rows of one order are always
  // adjacent: every sort above keys on order-level fields.
  const orderGroups: CostingReportRow[][] = [];
  for (const row of visibleRows) {
    const current = orderGroups[orderGroups.length - 1];
    if (current && current[0].salesOrderId === row.salesOrderId) current.push(row);
    else orderGroups.push([row]);
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th
              className={`${styles.tableHeadCell} ${styles.tableStickyCol} ${styles.tableStickyColFirst}`}
              aria-sort={orderNoSort === "asc" ? "ascending" : orderNoSort === "desc" ? "descending" : "none"}
            >
              <span className={styles.tableHeadControls}>
                Order no.
                <button
                  type="button"
                  onClick={onCycleOrderNoSort}
                  className={styles.tableHeadButton}
                  aria-label={
                    orderNoSort === null
                      ? "Sort by order number, ascending"
                      : orderNoSort === "asc"
                        ? "Sort by order number, descending"
                        : "Clear order number sort"
                  }
                  title="Sort by order number"
                >
                  <ChevronUpIcon
                    className={`${styles.sortChevron} ${orderNoSort === "asc" ? styles.sortChevronActive : ""}`}
                  />
                  <ChevronDownIcon
                    className={`${styles.sortChevron} ${orderNoSort === "desc" ? styles.sortChevronActive : ""}`}
                  />
                </button>
              </span>
            </th>
            <th className={`${styles.tableHeadCell} ${styles.tableStickyCol} ${styles.tableStickyColSecond} ${styles.tableStickyColEdge}`}>
              Product
            </th>
            <th className={styles.tableHeadCell}>Date</th>
            <th className={styles.tableHeadCell}>
              <span className={styles.tableHeadControls}>
                Customer
                <ColumnFilterDropdown
                  label="Filter by customer"
                  searchPlaceholder="Search customers…"
                  emptyMessage="No customers match."
                  options={customerFilterOptions}
                  selectedValues={customerFilterIds}
                  onChange={onCustomerFilterChange}
                />
              </span>
            </th>
            <th className={styles.tableHeadCell}>Qty</th>
            <th className={styles.tableHeadCell}>Purchase cost</th>
            <th className={styles.tableHeadCell}>Purchase tax</th>
            {printingColumnList.map(([key, label]) => (
              <th key={key} className={styles.tableHeadCell}>
                Printing: {label}
              </th>
            ))}
            <th className={styles.tableHeadCell}>Printing tax</th>
            <th className={styles.tableHeadCell}>Delivery (uncharged)</th>
            <th className={styles.tableHeadCell}>Delivery (charged)</th>
            <th className={styles.tableHeadCell}>Misc</th>
            <th className={styles.tableHeadCell}>Total cost</th>
          </tr>
        </thead>
        <tbody>
          {orderGroups.map((group, groupIndex) => {
            const first = group[0];
            return [
              ...group.map((row, rowIndex) => (
                <tr
                  key={`${row.salesOrderId}-${row.productId}`}
                  // A rule above each order (bar the very first), so one
                  // order's products and total read as a block.
                  className={`${styles.tableRow} ${groupIndex > 0 && rowIndex === 0 ? styles.tableRowGroupStart : ""}`}
                >
                  <td
                    className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.tableStickyCol} ${styles.tableStickyColFirst}`}
                  >
                    <Link href={`/admin/orders/sales/${row.salesOrderId}/details`} title="Open costing sheet">
                      {row.orderNo}
                    </Link>
                  </td>
                  <td className={`${styles.tableCell} ${styles.tableStickyCol} ${styles.tableStickyColSecond} ${styles.tableStickyColEdge}`}>
                    {row.productName}
                    {!row.isCosted && <span className={styles.inactiveBadge}>Not costed</span>}
                  </td>
                  <td className={styles.tableCell}>{formatDate(row.date)}</td>
                  <td className={styles.tableCell}>{customerName(row.custId) ?? "—"}</td>
                  <td className={styles.tableCell}>{row.quantity}</td>
                  <td className={styles.tableCell}>{formatAmount(row.purchaseCost)}</td>
                  <td className={styles.tableCell}>{formatAmount(row.purchaseTax)}</td>
                  {printingColumnList.map(([key]) => {
                    const cost = printingCostOf(row, key);
                    return (
                      <td key={key} className={styles.tableCell}>
                        {cost === undefined ? "—" : formatAmount(cost)}
                      </td>
                    );
                  })}
                  <td className={styles.tableCell}>{formatAmount(printingTaxOf(row))}</td>
                  <td className={styles.tableCell}>{formatAmount(row.delivery)}</td>
                  <td className={styles.tableCell}>{rowIndex === 0 ? formatAmount(row.orderDeliveryCharge) : "—"}</td>
                  <td className={styles.tableCell}>{formatAmount(row.miscellaneous)}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                    {formatAmount(row.totalCost - row.delivery)}
                  </td>
                </tr>
              )),
              <tr key={`${first.salesOrderId}-total`} className={styles.tableSubtotalRow}>
                <td className={`${styles.tableCell} ${styles.tableStickyCol} ${styles.tableStickyColFirst}`}>Total</td>
                <td className={`${styles.tableCell} ${styles.tableStickyCol} ${styles.tableStickyColSecond} ${styles.tableStickyColEdge}`} />
                <td className={styles.tableCell} />
                <td className={styles.tableCell} />
                <td className={styles.tableCell}>{sumOf(group, (row) => row.quantity)}</td>
                <td className={styles.tableCell}>{formatAmount(sumOf(group, (row) => row.purchaseCost))}</td>
                <td className={styles.tableCell}>{formatAmount(sumOf(group, (row) => row.purchaseTax))}</td>
                {printingColumnList.map(([key]) => {
                  const costs = group.map((row) => printingCostOf(row, key)).filter((cost) => cost !== undefined);
                  return (
                    <td key={key} className={styles.tableCell}>
                      {costs.length === 0 ? "—" : formatAmount(costs.reduce((sum, cost) => sum + cost, 0))}
                    </td>
                  );
                })}
                <td className={styles.tableCell}>{formatAmount(sumOf(group, printingTaxOf))}</td>
                <td className={styles.tableCell}>{formatAmount(sumOf(group, (row) => row.delivery))}</td>
                <td className={styles.tableCell}>{formatAmount(first.orderDeliveryCharge)}</td>
                <td className={styles.tableCell}>{formatAmount(sumOf(group, (row) => row.miscellaneous))}</td>
                {/* The backend's totalCost includes each row's uncharged
                    delivery, so this sum is the whole order's cost. */}
                <td className={styles.tableCell}>{formatAmount(sumOf(group, (row) => row.totalCost))}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {loadState === "loading" && <p className={styles.pageSubtext}>Loading costing…</p>}
      {loadState === "error" && (
        <p role="alert" className={styles.formError}>
          Couldn&apos;t load the costing report. Try switching views again.
        </p>
      )}
      {loadState === "loaded" && visibleRows.length === 0 && <p className={styles.pageSubtext}>{emptyMessage}</p>}
    </div>
  );
}
