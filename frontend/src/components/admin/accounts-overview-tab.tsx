"use client";

// ---------------------------------------------------------------------------
// <AccountsOverviewTab> — the Overview / P&L tab of /admin/accounts
// ---------------------------------------------------------------------------
// Reads GET /admin/get_accounts_overview for the page's shared date range
// (accounts-page-client.tsx owns it and passes it down). Revenue is standard
// sales invoices dated in range, net of tax; cost is the matching sales order
// costing. See backend/app/api/routes/accounts.py for the full definitions.
//
// The costing-coverage notice is the important bit of honesty here: entering
// costing is optional, so an order without it contributes revenue but no
// cost, which inflates the margin. Rather than hide that, the tab says how
// many orders are costed and links to where the rest get filled in.
import Link from "next/link";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  type AccountsOverview,
} from "@/lib/accounts";
import { ChartLegend, GroupedBarChart, type ChartSeries } from "@/components/admin/accounts-charts";
import styles from "@/styles/dashboard.module.css";

const TREND_SERIES: ChartSeries[] = [
  { key: "revenue", label: "Revenue", tone: "revenue" },
  { key: "cost", label: "Cost of goods", tone: "cost" },
  { key: "profit", label: "Gross profit", tone: "profit" },
];

export function AccountsOverviewTab({ data }: { data: AccountsOverview }) {
  const uncostedOrders = data.salesOrdersInRange - data.salesOrdersCosted;

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard label="Revenue (net of tax)" value={formatCurrency(data.revenue)} />
        <StatCard label="Cost of goods" value={formatCurrency(data.costOfGoods)} />
        <StatCard
          label="Gross profit"
          value={formatCurrency(data.grossProfit)}
          tone={data.grossProfit < 0 ? "negative" : "positive"}
        />
        <StatCard label="Gross margin" value={data.revenue ? formatPercent(data.grossMarginPerc) : "—"} />
        <StatCard label="Invoices raised" value={`${data.invoiceCount}`} />
        <StatCard label="Avg invoice value" value={formatCurrency(data.averageInvoiceValue)} />
      </div>

      {uncostedOrders > 0 ? (
        <p className={styles.accountsNotice}>
          {uncostedOrders} of {data.salesOrdersInRange} sales orders in this range have no costing entered, so
          cost and profit above are understated. Add it from{" "}
          <Link className={styles.accountsNoticeLink} href="/admin/orders">
            Orders → Sales orders → Add details
          </Link>
          .
        </p>
      ) : null}

      <section className={styles.accountsSection}>
        <div className={styles.accountsSectionHeader}>
          <h2 className={styles.accountsSectionTitle}>Revenue, cost and profit by month</h2>
          <ChartLegend series={TREND_SERIES} />
        </div>
        <GroupedBarChart
          // Profit is passed through signed, not clamped: a loss-making month
          // draws no bar (the chart floors bar heights at zero) but its
          // tooltip still reports the real negative figure, which a clamp
          // here would have turned into a false "₹0".
          groups={data.trend.map((point) => ({
            label: point.label,
            values: { revenue: point.revenue, cost: point.cost, profit: point.profit },
          }))}
          series={TREND_SERIES}
          formatValue={formatCompactCurrency}
          emptyMessage="No invoices were raised in this range."
        />
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Top clients by revenue</h2>
        {data.topClients.length === 0 ? (
          <p className={styles.accountsChartEmpty}>No invoiced clients in this range.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCellSerial}>#</th>
                  <th className={styles.tableHeadCell}>Client</th>
                  <th className={styles.tableHeadCellTight}>Invoices</th>
                  <th className={styles.tableHeadCellTight}>Revenue</th>
                  <th className={styles.tableHeadCellTight}>Cost</th>
                  <th className={styles.tableHeadCellTight}>Gross profit</th>
                  <th className={styles.tableHeadCellTight}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.topClients.map((client, index) => (
                  <tr key={client.custId} className={styles.tableRow}>
                    <td className={styles.tableCellSerial}>{index + 1}</td>
                    <td className={styles.tableCellPrimary}>
                      {client.customerName}
                      {client.isFullyCosted ? null : (
                        <span className={styles.accountsFlag} title="Some orders have no costing entered">
                          partial costing
                        </span>
                      )}
                    </td>
                    <td className={styles.tableCellTight}>{client.invoiceCount}</td>
                    <td className={styles.tableCellTight}>{formatCurrency(client.revenue)}</td>
                    <td className={styles.tableCellTight}>{formatCurrency(client.cost)}</td>
                    <td
                      className={`${styles.tableCellTight} ${
                        client.profit < 0 ? styles.accountsNegative : styles.accountsPositive
                      }`}
                    >
                      {formatCurrency(client.profit)}
                    </td>
                    <td className={styles.tableCellTight}>
                      {client.revenue ? formatPercent((client.profit / client.revenue) * 100) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Monthly breakdown</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Month</th>
                <th className={styles.tableHeadCellTight}>Invoices</th>
                <th className={styles.tableHeadCellTight}>Revenue</th>
                <th className={styles.tableHeadCellTight}>Cost</th>
                <th className={styles.tableHeadCellTight}>Gross profit</th>
                <th className={styles.tableHeadCellTight}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((point) => (
                <tr key={point.period} className={styles.tableRow}>
                  <td className={styles.tableCellPrimary}>{point.label}</td>
                  <td className={styles.tableCellTight}>{point.invoiceCount}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(point.revenue)}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(point.cost)}</td>
                  <td
                    className={`${styles.tableCellTight} ${
                      point.profit < 0 ? styles.accountsNegative : styles.accountsPositive
                    }`}
                  >
                    {formatCurrency(point.profit)}
                  </td>
                  <td className={styles.tableCellTight}>
                    {point.revenue ? formatPercent((point.profit / point.revenue) * 100) : "—"}
                  </td>
                </tr>
              ))}
              <tr className={`${styles.tableRow} ${styles.accountsTotalRow}`}>
                <td className={styles.tableCellPrimary}>Total</td>
                <td className={styles.tableCellTight}>{data.invoiceCount}</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.revenue)}</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.costOfGoods)}</td>
                <td
                  className={`${styles.tableCellTight} ${
                    data.grossProfit < 0 ? styles.accountsNegative : styles.accountsPositive
                  }`}
                >
                  {formatCurrency(data.grossProfit)}
                </td>
                <td className={styles.tableCellTight}>
                  {data.revenue ? formatPercent(data.grossMarginPerc) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.accountsFootnote}>
          Revenue excludes GST ({formatCurrency(data.taxCollected)} collected in this range) and is net of
          discounts. Total billed to customers: {formatCurrency(data.totalBilled)}.
        </p>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={styles.statCard}>
      <p className={styles.statLabel}>{label}</p>
      <p
        className={`${styles.statValue} ${
          tone === "negative" ? styles.accountsNegative : tone === "positive" ? styles.accountsPositive : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
