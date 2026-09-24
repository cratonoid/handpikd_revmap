"use client";

// ---------------------------------------------------------------------------
// <SalesOrderCostingTable> — the "Costing" view on the Sales orders tab
// ---------------------------------------------------------------------------
// The cost side of every active sales order, one row per product per order:
// lines of the same product on one order are summed into a single row. The
// figures come pre-aggregated from GET /admin/get_sales_order_costing_report
// (lib/sales-order-costing-report.ts); nothing is computed here beyond
// picking the printing columns.
//
// Printing gets one column PER TYPE (Laser, UV, …) — whichever types appear
// in the rows currently shown — with their tax in a single column after
// them. Total cost excludes both taxes, matching the "Add details" sheet's
// Net final cost.
//
// It shares the status pills, customer filter and order-no sort with the
// Orders view (sales-orders-tab.tsx owns that state), so switching views
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
  // The "No ... sales orders" wording, shared with the Orders view.
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

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th
              className={styles.tableHeadCell}
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
            <th className={styles.tableHeadCell}>Product</th>
            <th className={styles.tableHeadCell}>Qty</th>
            <th className={styles.tableHeadCell}>Purchase cost</th>
            <th className={styles.tableHeadCell}>Purchase tax</th>
            {printingColumnList.map(([key, label]) => (
              <th key={key} className={styles.tableHeadCell}>
                Printing: {label}
              </th>
            ))}
            <th className={styles.tableHeadCell}>Printing tax</th>
            <th className={styles.tableHeadCell}>Delivery</th>
            <th className={styles.tableHeadCell}>Misc</th>
            <th className={styles.tableHeadCell}>Total cost</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const printingByKey = new Map(row.printingCosts.map((p) => [printingKey(p.printingType), p]));
            const printingTax = row.printingCosts.reduce((sum, printing) => sum + printing.tax, 0);
            return (
              <tr key={`${row.salesOrderId}-${row.productId}`} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  <Link href={`/admin/orders/sales/${row.salesOrderId}/details`} title="Open costing sheet">
                    {row.orderNo}
                  </Link>
                </td>
                <td className={styles.tableCell}>{formatDate(row.date)}</td>
                <td className={styles.tableCell}>{customerName(row.custId) ?? "—"}</td>
                <td className={styles.tableCell}>
                  {row.productName}
                  {!row.isCosted && <span className={styles.inactiveBadge}>Not costed</span>}
                </td>
                <td className={styles.tableCell}>{row.quantity}</td>
                <td className={styles.tableCell}>{formatAmount(row.purchaseCost)}</td>
                <td className={styles.tableCell}>{formatAmount(row.purchaseTax)}</td>
                {printingColumnList.map(([key]) => {
                  const printing = printingByKey.get(key);
                  return (
                    <td key={key} className={styles.tableCell}>
                      {printing ? formatAmount(printing.cost) : "—"}
                    </td>
                  );
                })}
                <td className={styles.tableCell}>{formatAmount(printingTax)}</td>
                <td className={styles.tableCell}>{formatAmount(row.delivery)}</td>
                <td className={styles.tableCell}>{formatAmount(row.miscellaneous)}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{formatAmount(row.totalCost)}</td>
              </tr>
            );
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
