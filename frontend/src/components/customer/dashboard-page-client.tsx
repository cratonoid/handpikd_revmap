"use client";

// ---------------------------------------------------------------------------
// <CustomerDashboardPageClient> — the interactive body of /customer
// ---------------------------------------------------------------------------
// Where a client's invoices stand: what's outstanding, what's late, what's
// settled, and the most recent few with their status. It reads the same
// GET /customer/get_my_invoices the invoices screen does and totals it here
// (summariseInvoiceStatus in lib/customer-invoices.ts, which follows the
// admin's receivables rules) — there is no separate stats endpoint to drift
// away from the list it claims to summarise.
//
// The figures are deliberately about status rather than sales volume: a
// client opening their portal wants to know whether they owe anything, not
// how much they have spent with us.
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchMyInvoices,
  formatAmount,
  summariseInvoiceStatus,
  type CustomerInvoice,
  type InvoiceStatus,
} from "@/lib/customer-invoices";
import styles from "@/styles/dashboard.module.css";
import { formatDate } from "@/lib/format-date";

type LoadState = "loading" | "loaded" | "failed";

// Same wording and colors as the invoices table, so a status doesn't change
// its name between the two screens.
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
};

const STATUS_COLOR: Record<InvoiceStatus, string> = {
  unpaid: styles.statusNew,
  paid: styles.statusCompleted,
};

const RECENT_LIMIT = 5;

export function CustomerDashboardPageClient() {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    fetchMyInvoices()
      .then((data) => {
        if (!cancelled) {
          setInvoices(data);
          setLoadState("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const summary = summariseInvoiceStatus(invoices);
  // Until the fetch lands, the cards show "—" rather than a confident ₹0.00 —
  // "you owe nothing" is not a thing to say before knowing.
  const ready = loadState === "loaded";

  const stats = [
    {
      label: "Outstanding",
      value: ready ? formatAmount(summary.outstandingAmount) : "—",
      caption: ready ? `${summary.outstandingCount} invoice(s) awaiting payment` : null,
    },
    {
      label: "Overdue",
      value: ready ? formatAmount(summary.overdueAmount) : "—",
      caption: ready ? `${summary.overdueCount} past its due date` : null,
    },
    {
      label: "Paid",
      value: ready ? formatAmount(summary.paidAmount) : "—",
      caption: ready ? `${summary.paidCount} invoice(s) settled` : null,
    },
  ];

  // Newest first already — the backend sorts the list by invoice date.
  const recent = invoices.slice(0, RECENT_LIMIT);

  return (
    <>
      <h1 className={styles.pageHeading}>Dashboard</h1>
      <p className={styles.pageSubtext}>
        Where your invoices stand. Figures cover tax invoices only — a proforma invoice isn&apos;t due for
        payment until a tax invoice is raised against it.
      </p>

      {loadState === "failed" && (
        <p role="alert" className={styles.formError}>
          Couldn&apos;t load your invoices. Please refresh the page or try again shortly.
        </p>
      )}

      <div className={styles.statGrid}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.statCard}>
            <p className={styles.statLabel}>{stat.label}</p>
            <p className={styles.statValue}>{stat.value}</p>
            {stat.caption && <p className={styles.statCaption}>{stat.caption}</p>}
          </div>
        ))}
      </div>

      <div className={styles.dashboardSectionHeader}>
        <h2 className={styles.dashboardSectionTitle}>Recent invoices</h2>
        <Link href="/customer/invoices" className={styles.linkButton}>
          View all invoices
        </Link>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Invoice no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>Due date</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((invoice) => (
              <tr key={invoice.id} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  {invoice.invoiceNoDisplay}
                </td>
                <td className={styles.tableCell}>{formatDate(invoice.date)}</td>
                <td className={styles.tableCell}>{formatDate(invoice.dueDate)}</td>
                <td className={`${styles.tableCell} ${styles.statusText} ${STATUS_COLOR[invoice.status]}`}>
                  {/* A proforma invoice has no payment status worth showing —
                      nothing is owed on one — so it says what it is instead. */}
                  {invoice.type === "proforma" ? "Proforma" : STATUS_LABEL[invoice.status]}
                </td>
                <td className={styles.tableCell}>{formatAmount(invoice.totalAmountAfterTax)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadState === "loading" && <p className={styles.pageSubtext}>Loading invoices…</p>}
        {ready && recent.length === 0 && (
          <p className={styles.pageSubtext}>No invoices have been raised for your account yet.</p>
        )}
      </div>
    </>
  );
}
