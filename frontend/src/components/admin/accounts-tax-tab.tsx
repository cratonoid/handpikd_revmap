"use client";

// ---------------------------------------------------------------------------
// <AccountsTaxTab> — the GST tab of /admin/accounts
// ---------------------------------------------------------------------------
// Reads GET /admin/get_accounts_tax_summary for the page's shared date range.
//
// Output tax is what was charged to customers on standard sales invoices;
// input tax is what was paid to vendors on purchase invoices. Net liability
// is output minus input — positive means payable to the department, negative
// means input credit carried forward.
//
// Asymmetry worth knowing about: the input side breaks down by SGST/CGST/IGST
// because the linked purchase order stores those percentages, while the
// output side cannot, because #sales_summary keeps a single tax_perc per line
// with no head split. The tab says so rather than leaving a blank card.
//
// This is a management view, not a filing. It counts what the system holds,
// which is only the same as a GSTR return if every invoice was entered here.
import {
  formatCompactCurrency,
  formatCurrency,
  type AccountsTaxSummary,
} from "@/lib/accounts";
import { ChartLegend, GroupedBarChart, type ChartSeries } from "@/components/admin/accounts-charts";
import styles from "@/styles/dashboard.module.css";

const TAX_SERIES: ChartSeries[] = [
  { key: "output", label: "Output tax (sales)", tone: "revenue" },
  { key: "input", label: "Input tax (purchases)", tone: "cost" },
];

export function AccountsTaxTab({ data }: { data: AccountsTaxSummary }) {
  const isPayable = data.netLiability >= 0;

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard
          label="Output tax collected"
          value={formatCurrency(data.outputTax)}
          caption={`On ${data.outputInvoiceCount} sales ${
            data.outputInvoiceCount === 1 ? "invoice" : "invoices"
          }`}
        />
        <StatCard
          label="Input tax paid"
          value={formatCurrency(data.inputTax)}
          caption={`On ${data.inputInvoiceCount} purchase ${
            data.inputInvoiceCount === 1 ? "invoice" : "invoices"
          }`}
        />
        <StatCard
          label={isPayable ? "Net GST payable" : "Input credit carried forward"}
          value={formatCurrency(Math.abs(data.netLiability))}
          caption={isPayable ? "Output minus input" : "Input exceeded output"}
          tone={isPayable ? "negative" : "positive"}
        />
        <StatCard
          label="Taxable value (sales)"
          value={formatCurrency(data.outputTaxableValue)}
          caption="Net of tax and discounts"
        />
      </div>

      <section className={styles.accountsSection}>
        <div className={styles.accountsSectionHeader}>
          <h2 className={styles.accountsSectionTitle}>Output vs input tax by month</h2>
          <ChartLegend series={TAX_SERIES} />
        </div>
        <GroupedBarChart
          groups={data.periods.map((period) => ({
            label: period.label,
            values: { output: period.outputTax, input: period.inputTax },
          }))}
          series={TAX_SERIES}
          formatValue={formatCompactCurrency}
          emptyMessage="No invoices in this range."
        />
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Output tax by head</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Head</th>
                <th className={styles.tableHeadCellTight}>Amount</th>
                <th className={styles.tableHeadCellTight}>Share</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "SGST", amount: data.outputSgst },
                { label: "CGST", amount: data.outputCgst },
                { label: "IGST", amount: data.outputIgst },
                { label: "Unclassified", amount: data.outputUnclassified },
              ].map((head) => (
                <tr key={head.label} className={styles.tableRow}>
                  <td className={styles.tableCellPrimary}>{head.label}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(head.amount)}</td>
                  <td className={styles.tableCellTight}>
                    {data.outputTax ? `${((head.amount / data.outputTax) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className={`${styles.tableRow} ${styles.accountsTotalRow}`}>
                <td className={styles.tableCellPrimary}>Total output tax</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.outputTax)}</td>
                <td className={styles.tableCellTight}>{data.outputTax ? "100.0%" : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.accountsFootnote}>
          Each sales invoice records the heads it was raised under, decided when it was raised from the
          client&apos;s GST state against ours. &quot;Unclassified&quot; is tax on invoices raised before that
          was stored, which have no head on record.
        </p>
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Input tax by head</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Head</th>
                <th className={styles.tableHeadCellTight}>Amount</th>
                <th className={styles.tableHeadCellTight}>Share</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "SGST", amount: data.inputSgst },
                { label: "CGST", amount: data.inputCgst },
                { label: "IGST", amount: data.inputIgst },
                { label: "Unclassified", amount: data.inputUnclassified },
              ].map((head) => (
                <tr key={head.label} className={styles.tableRow}>
                  <td className={styles.tableCellPrimary}>{head.label}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(head.amount)}</td>
                  <td className={styles.tableCellTight}>
                    {data.inputTax ? `${((head.amount / data.inputTax) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className={`${styles.tableRow} ${styles.accountsTotalRow}`}>
                <td className={styles.tableCellPrimary}>Total input tax</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.inputTax)}</td>
                <td className={styles.tableCellTight}>{data.inputTax ? "100.0%" : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.accountsFootnote}>
          The split follows each purchase invoice&apos;s linked purchase order, which records either
          SGST + CGST (intra-state) or IGST (inter-state). &quot;Unclassified&quot; is tax on purchase invoices
          whose order carries no percentages.
        </p>
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Monthly GST position</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Month</th>
                <th className={styles.tableHeadCellTight}>Output tax</th>
                <th className={styles.tableHeadCellTight}>Input tax</th>
                <th className={styles.tableHeadCellTight}>Net position</th>
              </tr>
            </thead>
            <tbody>
              {data.periods.map((period) => (
                <tr key={period.period} className={styles.tableRow}>
                  <td className={styles.tableCellPrimary}>{period.label}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(period.outputTax)}</td>
                  <td className={styles.tableCellTight}>{formatCurrency(period.inputTax)}</td>
                  <td
                    className={`${styles.tableCellTight} ${
                      period.netLiability >= 0 ? styles.accountsNegative : styles.accountsPositive
                    }`}
                  >
                    {period.netLiability >= 0
                      ? `${formatCurrency(period.netLiability)} payable`
                      : `${formatCurrency(Math.abs(period.netLiability))} credit`}
                  </td>
                </tr>
              ))}
              <tr className={`${styles.tableRow} ${styles.accountsTotalRow}`}>
                <td className={styles.tableCellPrimary}>Total</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.outputTax)}</td>
                <td className={styles.tableCellTight}>{formatCurrency(data.inputTax)}</td>
                <td
                  className={`${styles.tableCellTight} ${
                    isPayable ? styles.accountsNegative : styles.accountsPositive
                  }`}
                >
                  {isPayable
                    ? `${formatCurrency(data.netLiability)} payable`
                    : `${formatCurrency(Math.abs(data.netLiability))} credit`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.accountsFootnote}>
          A management view of what this system holds, not a filed return — it matches a GSTR only if every
          sales and purchase invoice for the period was entered here. Purchase taxable value in this range:{" "}
          {formatCurrency(data.inputTaxableValue)}.
        </p>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
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
      {caption ? <p className={styles.accountsStatCaption}>{caption}</p> : null}
    </div>
  );
}
