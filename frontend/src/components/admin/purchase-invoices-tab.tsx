"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoicesTab> — the Purchase Invoices half of /admin/invoices
// ---------------------------------------------------------------------------
// Mirrors invoices-tab.tsx, minus an "add" action: a purchase invoice is
// raised automatically as part of creating its purchase order (Purchase
// orders tab on /admin/orders), whether that order was keyed in or read off
// the vendor's invoice PDF, so there's nothing to add here — an invoice with
// no order behind it was never a valid record. Double-clicking a row opens
// purchase-invoice-form-modal.tsx to edit its date, attach or replace the
// vendor's PDF, or void it, via update_purchase_invoice_details /
// attach_purchase_invoice_pdf (backend/app/api/routes/purchase_invoices.py).
// Purely a billing record — none of it touches inventory (unlike a purchase
// order being received).
import { useEffect, useState } from "react";
import { PurchaseInvoiceFormModal } from "@/components/admin/purchase-invoice-form-modal";
import {
  downloadPurchaseInvoicePdf,
  downloadUploadedPurchaseInvoicePdf,
  fetchPurchaseInvoices,
  type PurchaseInvoice,
} from "@/lib/purchase-invoices";
import { fetchPurchaseOrders, type PurchaseOrder } from "@/lib/purchase-orders";
import { fetchVendorsList, type VendorOption } from "@/lib/vendors";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "edit"; purchaseInvoice: PurchaseInvoice } | null;
type LoadState = "loading" | "loaded";

export function PurchaseInvoicesTab() {
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  function loadAll() {
    return Promise.all([fetchPurchaseInvoices(), fetchPurchaseOrders(), fetchVendorsList()]).then(
      ([purchaseInvoiceData, purchaseOrderData, vendorData]) => {
        setPurchaseInvoices(purchaseInvoiceData);
        setPurchaseOrders(purchaseOrderData);
        setVendors(vendorData);
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
        if (!cancelled) setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function refreshPurchaseInvoices() {
    fetchPurchaseInvoices()
      .then(setPurchaseInvoices)
      .catch(() => {});
  }

  function handleSaved() {
    setModalState(null);
    refreshPurchaseInvoices();
  }

  async function handleDownload(purchaseInvoice: PurchaseInvoice) {
    setDownloadError(null);
    setDownloadingId(purchaseInvoice.id);
    try {
      await downloadPurchaseInvoicePdf(purchaseInvoice.id, purchaseInvoice.purchaseInvoiceNoDisplay);
    } catch {
      setDownloadError(`Couldn't generate the PDF for purchase invoice ${purchaseInvoice.purchaseInvoiceNoDisplay}.`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDownloadOriginal(purchaseInvoice: PurchaseInvoice) {
    setDownloadError(null);
    try {
      await downloadUploadedPurchaseInvoicePdf(purchaseInvoice.id, purchaseInvoice.purchaseInvoiceNoDisplay);
    } catch {
      setDownloadError(`Couldn't download the original PDF for purchase invoice ${purchaseInvoice.purchaseInvoiceNoDisplay}.`);
    }
  }

  return (
    <>
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
              <th className={styles.tableHeadCell}>Purchase invoice no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>PO number</th>
              <th className={styles.tableHeadCell}>Amount</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {purchaseInvoices.map((purchaseInvoice, index) => {
              const po = purchaseInvoice.poId ? purchaseOrdersById.get(purchaseInvoice.poId) : undefined;
              const poNumberLabel = po ? `PO-${po.purchaseOrderNo}` : "—";
              return (
                <tr
                  key={purchaseInvoice.id}
                  onDoubleClick={() => setModalState({ mode: "edit", purchaseInvoice })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                    {purchaseInvoice.purchaseInvoiceNoDisplay}
                  </td>
                  <td className={styles.tableCell}>{new Date(purchaseInvoice.date).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{vendorsById.get(purchaseInvoice.vendorId)?.name ?? "—"}</td>
                  <td className={styles.tableCell}>{poNumberLabel}</td>
                  <td className={styles.tableCell}>₹{purchaseInvoice.totalAmountAfterTax.toFixed(2)}</td>
                  <td className={styles.tableCell}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(purchaseInvoice);
                      }}
                      disabled={downloadingId === purchaseInvoice.id}
                      className={styles.triggerButtonBase}
                    >
                      {downloadingId === purchaseInvoice.id ? "Generating…" : "Download"}
                    </button>
                    {purchaseInvoice.hasUploadedPdf && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDownloadOriginal(purchaseInvoice);
                        }}
                        className={styles.triggerButtonBase}
                      >
                        Original
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading purchase invoices…</p>}
        {loadState === "loaded" && purchaseInvoices.length === 0 && (
          <p className={styles.pageSubtext}>No purchase invoices raised yet.</p>
        )}
      </div>

      {modalState && (
        <PurchaseInvoiceFormModal
          purchaseInvoice={modalState.purchaseInvoice}
          vendors={vendors}
          purchaseOrders={purchaseOrders}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
          onPdfAttached={refreshPurchaseInvoices}
        />
      )}
    </>
  );
}
