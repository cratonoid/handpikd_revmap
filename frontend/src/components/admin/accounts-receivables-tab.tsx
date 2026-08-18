"use client";

// ---------------------------------------------------------------------------
// <AccountsReceivablesTab> — the "money in" tab of /admin/accounts
// ---------------------------------------------------------------------------
// Reads GET /admin/get_accounts_receivables for the page's shared date range.
// Scope is unpaid standard sales invoices (status new or submitted) raised in
// that range; the paid ones show up only as the "collected" figure.
//
// The two clocks at work here trip people up, so the tab states both: the
// date RANGE picks which invoices are listed, but the AGING is measured
// against today, not the range end. An invoice raised in January really is
// 200 days late today, and a report that aged it against 31 January would
// call a bad debt current.
//
// There is no part-payment field on #invoice_details — status is
// all-or-nothing — so an invoice is either fully outstanding or fully paid.
import {
  formatCurrency,
  formatDate,
  type AccountsReceivables,
} from "@/lib/accounts";
import { HorizontalBreakdown, type BreakdownRow } from "@/components/admin/accounts-charts";
import styles from "@/styles/dashboard.module.css";

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  submitted: "Submitted",
  paid: "Paid",
};

export function AccountsReceivablesTab({ data }: { data: AccountsReceivables }) {
  const agingRows: BreakdownRow[] = data.aging.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: bucket.amount,
    caption: `${bucket.invoiceCount} ${bucket.invoiceCount === 1 ? "invoice" : "invoices"}`,
    // Anything past its due date reads as a problem; not-yet-due is neutral.
    tone: bucket.key === "not_due" ? "revenue" : "overdue",
  }));

  return (
    <>
      <div className={styles.statGrid}>
        <StatCard
          label="Total outstanding"
          value={formatCurrency(data.totalOutstanding)}
          caption={`${data.outstandingInvoiceCount} unpaid ${
            data.outstandingInvoiceCount === 1 ? "invoice" : "invoices"
          }`}
        />
        <StatCard
          label="Overdue"
          value={formatCurrency(data.overdueAmount)}
          caption={`${data.overdueInvoiceCount} past due date`}
          tone={data.overdueAmount > 0 ? "negative" : undefined}
        />
        <StatCard
          label="Avg days overdue"
          value={data.overdueInvoiceCount ? `${data.averageDaysOverdue}` : "—"}
          caption="Across overdue invoices"
        />
        <StatCard
          label="Collected in range"
          value={formatCurrency(data.collectedInRange)}
          caption={`${data.paidInvoiceCount} marked paid`}
          tone={data.collectedInRange > 0 ? "positive" : undefined}
        />
      </div>

      <p className={styles.accountsNotice}>
        Aging is measured against today ({formatDate(data.asOf)}), not the end of the selected range. The date
        range chooses which invoices are listed; how late they are is always as of now.
      </p>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Aging</h2>
        <HorizontalBreakdown
          rows={agingRows}
          formatValue={formatCurrency}
          emptyMessage="No unpaid invoices were raised in this range."
        />
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Outstanding by client</h2>
        {data.clients.length === 0 ? (
          <p className={styles.accountsChartEmpty}>Nothing outstanding in this range.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCellSerial}>#</th>
                  <th className={styles.tableHeadCell}>Client</th>
                  <th className={styles.tableHeadCellTight}>Invoices</th>
                  <th className={styles.tableHeadCellTight}>Outstanding</th>
                  <th className={styles.tableHeadCellTight}>Overdue</th>
                  <th className={styles.tableHeadCellTight}>Oldest overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((client, index) => (
                  <tr key={client.custId} className={styles.tableRow}>
                    <td className={styles.tableCellSerial}>{index + 1}</td>
                    <td className={styles.tableCellPrimary}>{client.customerName}</td>
                    <td className={styles.tableCellTight}>{client.invoiceCount}</td>
                    <td className={styles.tableCellTight}>{formatCurrency(client.outstanding)}</td>
                    <td
                      className={`${styles.tableCellTight} ${client.overdue > 0 ? styles.accountsNegative : ""}`}
                    >
                      {client.overdue > 0 ? formatCurrency(client.overdue) : "—"}
                    </td>
                    <td className={styles.tableCellTight}>
                      {client.oldestOverdueDays > 0 ? `${client.oldestOverdueDays} days` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.accountsSection}>
        <h2 className={styles.accountsSectionTitle}>Unpaid invoices</h2>
        {data.invoices.length === 0 ? (
          <p className={styles.accountsChartEmpty}>No unpaid invoices were raised in this range.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>Invoice</th>
                  <th className={styles.tableHeadCell}>Client</th>
                  <th className={styles.tableHeadCellTight}>Date</th>
                  <th className={styles.tableHeadCellTight}>Due</th>
                  <th className={styles.tableHeadCellTight}>Amount</th>
                  <th className={styles.tableHeadCellTight}>Status</th>
                  <th className={styles.tableHeadCellTight}>Overdue by</th>
                </tr>
              </thead>
              <tbody>
                {/* Sorted most-overdue-first by the backend, so reading top to
                    bottom is the collections worklist in priority order. */}
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id} className={styles.tableRow}>
                    <td className={styles.tableCellPrimary}>{invoice.invoiceNoDisplay}</td>
                    <td className={styles.tableCell}>{invoice.customerName}</td>
                    <td className={styles.tableCellTight}>{formatDate(invoice.date)}</td>
                    <td className={styles.tableCellTight}>{formatDate(invoice.dueDate)}</td>
                    <td className={styles.tableCellTight}>{formatCurrency(invoice.amount)}</td>
                    <td className={styles.tableCellTight}>
                      <span className={styles.statusText}>{STATUS_LABEL[invoice.status] ?? invoice.status}</span>
                    </td>
                    <td
                      className={`${styles.tableCellTight} ${
                        invoice.daysOverdue > 0 ? styles.accountsNegative : ""
                      }`}
                    >
                      {invoice.daysOverdue > 0 ? `${invoice.daysOverdue} days` : "Not due"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.accountsFootnote}>
          Amounts are the full invoice value including GST — invoices are marked paid in full, so partial
          payments aren&apos;t tracked.
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
