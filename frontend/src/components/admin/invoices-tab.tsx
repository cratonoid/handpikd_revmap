"use client";

// ---------------------------------------------------------------------------
// <InvoicesTab> — the Sales Invoices half of /admin/invoices
// ---------------------------------------------------------------------------
// Mirrors sales-orders-tab.tsx, plus an inner Standard/Proforma view toggle
// (same .viewToggle pattern as invoices-page-client.tsx/orders-page-client.tsx)
// filtering the one GET /admin/get_invoice_details list client-side by
// invoice.type. Both views support "+ New invoice", opening the popup in
// "add" mode; double-clicking a row opens it in "edit" mode. Standard saves
// through invoice-form-modal.tsx (POSTs to create_new_invoice/
// update_invoice_details); Proforma saves through
// proforma-invoice-form-modal.tsx (its own line items, POSTs to
// create_new_proforma_invoice/update_proforma_invoice_details) — both in
// backend/app/api/routes/invoices.py.
//
// "Company details" opens personal-details-modal.tsx — the seller/bank/terms
// info baked onto every generated PDF (backend/app/services/invoice_pdf.py,
// proforma_invoice_pdf.py), stored in the #personal_details EAV table
// (lib/personal-details.ts).
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { InvoiceFormModal } from "@/components/admin/invoice-form-modal";
import { ProformaInvoiceFormModal } from "@/components/admin/proforma-invoice-form-modal";
import { PersonalDetailsModal } from "@/components/admin/personal-details-modal";
import {
  downloadInvoicePdf,
  downloadInvoicesZip,
  fetchInvoices,
  type Invoice,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/invoices";
import { fetchPersonalDetails } from "@/lib/personal-details";
import { fetchSalesOrders, type SalesOrder } from "@/lib/sales-orders";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchCustomerList, type CustomerOption } from "@/lib/customers";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; invoice: Invoice } | null;
type LoadState = "loading" | "loaded";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  new: "New",
  submitted: "Submitted",
  paid: "Paid",
};

export function InvoicesTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [personalDetails, setPersonalDetails] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("standard");
  const [bulkFromDate, setBulkFromDate] = useState("");
  const [bulkToDate, setBulkToDate] = useState("");
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkDownloadError, setBulkDownloadError] = useState<string | null>(null);

  const salesOrdersById = new Map(salesOrders.map((order) => [order.id, order]));
  const customersById = new Map(customers.map((c) => [c.id, c]));
  const visibleInvoices = invoices.filter((invoice) => invoice.type === invoiceType);

  function loadAll() {
    return Promise.all([
      fetchInvoices(),
      fetchSalesOrders(),
      fetchProducts(),
      fetchCustomerList(),
      fetchPersonalDetails(),
    ]).then(([invoiceData, salesOrderData, productData, customerData, personalData]) => {
      setInvoices(invoiceData);
      setSalesOrders(salesOrderData);
      setProducts(productData);
      setCustomers(customerData);
      setPersonalDetails(personalData);
    });
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

  // "add" mode has no invoice yet to read a type off, so it falls back to
  // whichever view (Standard/Proforma) the "+ New invoice" button was
  // clicked from.
  const modalInvoiceType: InvoiceType | null = modalState
    ? modalState.mode === "edit"
      ? modalState.invoice.type
      : invoiceType
    : null;

  async function handleDownload(invoice: Invoice) {
    setDownloadError(null);
    setDownloadingId(invoice.id);
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoiceNoDisplay);
    } catch {
      setDownloadError(`Couldn't generate the PDF for invoice ${invoice.invoiceNoDisplay}.`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleBulkDownload() {
    setBulkDownloadError(null);
    setBulkDownloading(true);
    try {
      await downloadInvoicesZip(bulkFromDate, bulkToDate);
    } catch (err) {
      setBulkDownloadError(err instanceof Error ? err.message : "Couldn't generate the invoices zip.");
    } finally {
      setBulkDownloading(false);
    }
  }

  return (
    <>
      <div className={styles.invoicesToolbar}>
        <div className={styles.viewToggle} role="tablist" aria-label="Invoice type">
          <button
            type="button"
            role="tab"
            aria-selected={invoiceType === "standard"}
            onClick={() => setInvoiceType("standard")}
            className={`${styles.viewToggleButton} ${invoiceType === "standard" ? styles.viewToggleButtonActive : ""}`}
          >
            Standard
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
        <div className={styles.invoicesToolbarActions}>
          {invoiceType === "standard" && (
            <div className={`${styles.invoicesFilterRow} ${styles.invoicesToolbarFilters}`}>
              <div className={styles.invoicesFilterField}>
                <label htmlFor="bulkFromDate" className={styles.formLabel}>
                  From
                </label>
                <input
                  id="bulkFromDate"
                  type="date"
                  value={bulkFromDate}
                  onChange={(e) => setBulkFromDate(e.target.value)}
                  className={styles.formInput}
                />
              </div>
              <div className={styles.invoicesFilterField}>
                <label htmlFor="bulkToDate" className={styles.formLabel}>
                  To
                </label>
                <input
                  id="bulkToDate"
                  type="date"
                  value={bulkToDate}
                  onChange={(e) => setBulkToDate(e.target.value)}
                  className={styles.formInput}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleBulkDownload()}
                disabled={!bulkFromDate || !bulkToDate || bulkDownloading}
              >
                {bulkDownloading ? "Preparing…" : "Download all"}
              </Button>
            </div>
          )}
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

      {bulkDownloadError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {bulkDownloadError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Invoice no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              {invoiceType === "standard" && <th className={styles.tableHeadCell}>Sales order</th>}
              <th className={styles.tableHeadCell}>Customer</th>
              {invoiceType === "proforma" && <th className={styles.tableHeadCell}>Due date</th>}
              {invoiceType === "standard" && <th className={styles.tableHeadCell}>Status</th>}
              <th className={styles.tableHeadCell}>Amount</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {visibleInvoices.map((invoice, index) => {
              const linkedSalesOrders = invoice.salesIds
                .map((id) => salesOrdersById.get(id))
                .filter((order): order is SalesOrder => !!order);
              const custId = linkedSalesOrders[0]?.custId ?? invoice.custId ?? undefined;
              const customerName = custId !== undefined ? customersById.get(custId)?.name : undefined;
              return (
                <tr
                  key={invoice.id || `${invoice.invoiceNo}-${index}`}
                  onDoubleClick={() => setModalState({ mode: "edit", invoice })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{invoice.invoiceNoDisplay}</td>
                  <td className={styles.tableCell}>{new Date(invoice.date).toLocaleDateString()}</td>
                  {invoiceType === "standard" && (
                    <td className={styles.tableCell}>
                      {linkedSalesOrders.length > 0
                        ? linkedSalesOrders.map((order) => `SO-${order.orderNo}`).join(", ")
                        : "—"}
                    </td>
                  )}
                  <td className={styles.tableCell}>{customerName ?? "—"}</td>
                  {invoiceType === "proforma" && (
                    <td className={styles.tableCell}>{new Date(invoice.dueDate).toLocaleDateString()}</td>
                  )}
                  {invoiceType === "standard" && (
                    <td className={styles.tableCell}>{STATUS_LABEL[invoice.status]}</td>
                  )}
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
        {loadState === "loaded" && visibleInvoices.length === 0 && (
          <p className={styles.pageSubtext}>
            {invoiceType === "standard" ? "No invoices raised yet." : "No proforma invoices raised yet."}
          </p>
        )}
      </div>

      {modalState && modalInvoiceType === "standard" && (
        <InvoiceFormModal
          mode={modalState.mode}
          initialInvoice={modalState.mode === "edit" ? modalState.invoice : undefined}
          salesOrders={salesOrders}
          customers={customers}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {modalState && modalInvoiceType === "proforma" && (
        <ProformaInvoiceFormModal
          mode={modalState.mode}
          initialInvoice={modalState.mode === "edit" ? modalState.invoice : undefined}
          customers={customers}
          products={products}
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
