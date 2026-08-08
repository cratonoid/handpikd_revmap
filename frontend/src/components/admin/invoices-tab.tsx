"use client";

// ---------------------------------------------------------------------------
// <InvoicesTab> — the interactive body of /admin/invoices
// ---------------------------------------------------------------------------
// Mirrors sales-orders-tab.tsx. GET /admin/get_invoice_details only ever
// returns active (non-deleted) invoices. "+ New invoice" opens the popup in
// "add" mode; double-clicking a row opens it in "edit" mode. Both modes save
// through invoice-form-modal.tsx, which POSTs to
// create_new_invoice/update_invoice_details (backend/app/api/routes/invoices.py).
//
// "Company details" opens personal-details-modal.tsx — the seller/bank/terms
// info baked onto every generated PDF (backend/app/services/invoice_pdf.py),
// stored in the #personal_details EAV table (lib/personal-details.ts).
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { InvoiceFormModal } from "@/components/admin/invoice-form-modal";
import { PersonalDetailsModal } from "@/components/admin/personal-details-modal";
import { downloadInvoicePdf, fetchInvoices, type Invoice } from "@/lib/invoices";
import { fetchPersonalDetails } from "@/lib/personal-details";
import { fetchSalesOrders, type SalesOrder } from "@/lib/sales-orders";
import { fetchCustomerList, type CustomerOption } from "@/lib/customers";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; invoice: Invoice } | null;
type LoadState = "loading" | "loaded";

export function InvoicesTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [personalDetails, setPersonalDetails] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const salesOrdersById = new Map(salesOrders.map((order) => [order.id, order]));
  const customersById = new Map(customers.map((c) => [c.id, c]));

  function loadAll() {
    return Promise.all([fetchInvoices(), fetchSalesOrders(), fetchCustomerList(), fetchPersonalDetails()]).then(
      ([invoiceData, salesOrderData, customerData, personalData]) => {
        setInvoices(invoiceData);
        setSalesOrders(salesOrderData);
        setCustomers(customerData);
        setPersonalDetails(personalData);
      },
    );
  }

  useEffect(() => {
    let cancelled = false;

    loadAll()
      .then(() => {
        if (!cancelled) setLoadState("loaded");
      })
      .catch(() => {
        // A failed fetch (e.g. the backend being unreachable) falls back to
        // an empty list rather than showing a scary error.
        if (!cancelled) setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches the full list instead of upserting a client-constructed
  // invoice, since create_new_invoice/update_invoice_details only return
  // {message} — no real id to key off of (same reasoning as
  // sales-orders-tab.tsx's handleSaved).
  function handleSaved() {
    setModalState(null);
    fetchInvoices()
      .then(setInvoices)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the save itself already succeeded.
      });
  }

  function handleCompanyDetailsSaved() {
    setShowCompanyDetails(false);
    fetchPersonalDetails()
      .then(setPersonalDetails)
      .catch(() => {});
  }

  async function handleDownload(invoice: Invoice) {
    setDownloadError(null);
    setDownloadingId(invoice.id);
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoiceNo);
    } catch {
      setDownloadError(`Couldn't generate the PDF for invoice ${invoice.invoiceNo}.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <h1 className={styles.pageHeading}>Invoices</h1>
      <p className={styles.pageSubtext}>Generate, send, and track payment status of invoices.</p>

      <div className={styles.pageHeaderRow}>
        <p className={styles.pageSubtext}>Raise invoices against existing sales orders.</p>
        <div className={styles.modalActionsRight}>
          <Button type="button" variant="tertiary" onClick={() => setShowCompanyDetails(true)}>
            Company details
          </Button>
          <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
            + New invoice
          </Button>
        </div>
      </div>

      {downloadError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {downloadError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Invoice no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>Sales order</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Due date</th>
              <th className={styles.tableHeadCell}>Payment</th>
              <th className={styles.tableHeadCell}>Amount</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice, index) => {
              const salesOrder = salesOrdersById.get(invoice.salesId);
              const customerName = salesOrder ? customersById.get(salesOrder.custId)?.name : undefined;
              return (
                <tr
                  key={invoice.id || `${invoice.invoiceNo}-${index}`}
                  onDoubleClick={() => setModalState({ mode: "edit", invoice })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{invoice.invoiceNo}</td>
                  <td className={styles.tableCell}>{new Date(invoice.date).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{salesOrder ? `SO-${salesOrder.orderNo}` : "—"}</td>
                  <td className={styles.tableCell}>{customerName ?? "—"}</td>
                  <td className={styles.tableCell}>{invoice.type === "proforma" ? "Proforma" : "Standard"}</td>
                  <td className={styles.tableCell}>{new Date(invoice.dueDate).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{invoice.onlineOrOffline === "online" ? "Online" : "Offline"}</td>
                  <td className={styles.tableCell}>₹{invoice.totalAmountAfterTax.toFixed(2)}</td>
                  <td className={styles.tableCell}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(invoice);
                      }}
                      disabled={downloadingId === invoice.id}
                      className={styles.triggerButtonBase}
                    >
                      {downloadingId === invoice.id ? "Generating…" : "Download"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading invoices…</p>}
        {loadState === "loaded" && invoices.length === 0 && (
          <p className={styles.pageSubtext}>No invoices raised yet.</p>
        )}
      </div>

      {modalState && (
        <InvoiceFormModal
          mode={modalState.mode}
          initialInvoice={modalState.mode === "edit" ? modalState.invoice : undefined}
          salesOrders={salesOrders}
          customers={customers}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {showCompanyDetails && (
        <PersonalDetailsModal
          initialValues={personalDetails}
          onClose={() => setShowCompanyDetails(false)}
          onSaved={handleCompanyDetailsSaved}
        />
      )}
    </>
  );
}
