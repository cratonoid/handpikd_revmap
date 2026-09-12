"use client";

// ---------------------------------------------------------------------------
// <CustomerInvoicesPageClient> — the interactive half of /customer/invoices
// ---------------------------------------------------------------------------
// A client's own invoices: the list, one invoice's details in a popup
// (components/customer/invoice-detail-modal.tsx), and the PDF. Everything
// comes from GET /customer/get_my_invoices, which is already scoped to the
// signed-in login server-side — this screen has no client id to pass and no
// way to ask for anyone else's.
//
// Same Standard/Proforma view toggle as the admin's invoices-tab.tsx, off the
// one list filtered client-side by invoice.type. Deliberately labelled "Tax
// invoices" and "Proforma" here rather than "Standard"/"Proforma": from the
// client's side the distinction that matters is which of the two is the
// statutory document.
//
// Unlike the admin table, a row opens on a single click, not a double one —
// there is no edit mode for the double click to be reserved against, and a
// popup that only opens on a gesture that doesn't exist on a phone would
// make the details unreachable there.
import { useEffect, useState } from "react";
import { CustomerInvoiceDetailModal } from "@/components/customer/invoice-detail-modal";
import {
  downloadMyInvoicePdf,
  fetchMyInvoices,
  formatAmount,
  type CustomerInvoice,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/customer-invoices";
import styles from "@/styles/dashboard.module.css";
import { formatDate } from "@/lib/format-date";

type LoadState = "loading" | "loaded" | "failed";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
};

// Ochre for money still owed, green for a settled invoice — the point is
// only that a settled invoice reads differently from an outstanding one
// without having to read the word. Shared with the admin side's invoices
// table (see components/admin/invoices-tab.tsx) so a status doesn't change
// meaning between the two sides of the same document.
const STATUS_COLOR: Record<InvoiceStatus, string> = {
  unpaid: styles.statusUnpaid,
  paid: styles.statusPaid,
};

export function CustomerInvoicesPageClient() {
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("standard");
  const [openInvoice, setOpenInvoice] = useState<CustomerInvoice | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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
        // Unlike the admin tables, this doesn't fall back to an empty list:
        // "you have no invoices" and "we couldn't reach the server" are very
        // different things to tell someone about their own billing.
        if (!cancelled) setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleInvoices = invoices.filter((invoice) => invoice.type === invoiceType);

  async function handleDownload(invoice: CustomerInvoice) {
    setDownloadError(null);
    setDownloadingId(invoice.id);
    try {
      await downloadMyInvoicePdf(invoice.id, invoice.invoiceNoDisplay);
    } catch {
      setDownloadError(`Couldn't download invoice ${invoice.invoiceNoDisplay}. Please try again.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <div className={styles.invoicesPageHeader}>
        <h1 className={styles.pageHeading}>Invoices</h1>
        <div className={styles.viewToggle} role="tablist" aria-label="Invoice type">
          <button
            type="button"
            role="tab"
            aria-selected={invoiceType === "standard"}
            onClick={() => setInvoiceType("standard")}
            className={`${styles.viewToggleButton} ${invoiceType === "standard" ? styles.viewToggleButtonActive : ""}`}
          >
            Tax invoices
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={invoiceType === "proforma"}
            onClick={() => setInvoiceType("proforma")}
            className={`${styles.viewToggleButton} ${invoiceType === "proforma" ? styles.viewToggleButtonActive : ""}`}
          >
            Proforma
          </button>
        </div>
      </div>

      <p className={styles.pageSubtext}>
        Every invoice raised for your account. Select one to see its line items, or download it as a PDF.
      </p>

      {downloadError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {downloadError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Invoice no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              {invoiceType === "standard" && <th className={styles.tableHeadCell}>Order</th>}
              <th className={styles.tableHeadCell}>Due date</th>
              {invoiceType === "standard" && <th className={styles.tableHeadCell}>Status</th>}
              <th className={styles.tableHeadCell}>Amount</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((invoice) => (
              <tr key={invoice.id} onClick={() => setOpenInvoice(invoice)} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  {invoice.invoiceNoDisplay}
                </td>
                <td className={styles.tableCell}>{formatDate(invoice.date)}</td>
                {invoiceType === "standard" && (
                  <td className={styles.tableCell}>
                    {invoice.salesOrderNos.length > 0
                      ? invoice.salesOrderNos.map((orderNo) => `SO-${orderNo}`).join(", ")
                      : "—"}
                  </td>
                )}
                <td className={styles.tableCell}>{formatDate(invoice.dueDate)}</td>
                {invoiceType === "standard" && (
                  <td className={`${styles.tableCell} ${styles.statusText} ${STATUS_COLOR[invoice.status]}`}>
                    {STATUS_LABEL[invoice.status]}
                  </td>
                )}
                <td className={styles.tableCell}>{formatAmount(invoice.totalAmountAfterTax)}</td>
                <td className={styles.tableCell}>
                  <button
                    type="button"
                    onClick={(event) => {
                      // Otherwise the click bubbles to the row and opens the
                      // details popup on top of the download.
                      event.stopPropagation();
                      void handleDownload(invoice);
                    }}
                    disabled={downloadingId === invoice.id}
                    className={styles.triggerButtonBase}
                  >
                    {downloadingId === invoice.id ? "Preparing…" : "Download"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loadState === "loading" && <p className={styles.pageSubtext}>Loading invoices…</p>}
        {loadState === "failed" && (
          <p role="alert" className={styles.formError}>
            Couldn&apos;t load your invoices. Please refresh the page or try again shortly.
          </p>
        )}
        {loadState === "loaded" && visibleInvoices.length === 0 && (
          <p className={styles.pageSubtext}>
            {invoiceType === "standard"
              ? "No invoices have been raised for your account yet."
              : "No proforma invoices for your account yet."}
          </p>
        )}
      </div>

      {openInvoice && (
        <CustomerInvoiceDetailModal
          invoice={openInvoice}
          downloading={downloadingId === openInvoice.id}
          onDownload={() => void handleDownload(openInvoice)}
          onClose={() => setOpenInvoice(null)}
        />
      )}
    </>
  );
}
