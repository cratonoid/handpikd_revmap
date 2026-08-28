"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoicesTab> — the Purchase Invoices half of /admin/invoices
// ---------------------------------------------------------------------------
// Two views behind one tab, Material and Printing, on the same .viewToggle
// pattern the Sales invoices tab uses for Standard/Proforma — and for the
// same reason: they are two different documents in two different
// collections, numbered PINV-nnnn and PPINV-nnnn off their own series, not
// one list under a filter. Which one a purchase becomes follows from the
// vendor's type, decided back on the purchase order.
//
// Neither view has an "add" action: a purchase invoice of either kind is
// raised automatically as part of creating its purchase order (Purchase
// orders tab on /admin/orders), so there is nothing to add here — an invoice
// with no order behind it was never a valid record. Double-clicking a row
// opens the matching edit popup for its date, its vendor PDF, or to void it.
// Purely billing records — none of it touches inventory.
//
// Neither view offers a branded PDF. A purchase invoice of either kind
// records what a VENDOR billed us, so their own document is the
// authoritative one and the only one served — a row with nothing attached
// shows a dash rather than a button that could only 404. Sales invoices
// still render; those are documents we genuinely issue.
//
// Both views carry the same From/To + "Download all" control the Sales
// invoices tab has, zipping a date range's PDFs in one go (filing a quarter
// with the accountant, mostly). It downloads whichever list is on screen,
// since Material and Printing are separate series in separate collections —
// and because the only PDF here is the vendor's own, the zip holds just the
// invoices that actually have one attached; the rest are skipped rather than
// failing the download.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { PurchaseInvoiceFormModal } from "@/components/admin/purchase-invoice-form-modal";
import { PrintingPurchaseInvoiceFormModal } from "@/components/admin/printing-purchase-invoice-form-modal";
import {
  downloadPurchaseInvoicesZip,
  downloadUploadedPurchaseInvoicePdf,
  fetchPurchaseInvoices,
  type PurchaseInvoice,
} from "@/lib/purchase-invoices";
import {
  downloadPrintingPurchaseInvoicesZip,
  downloadUploadedPrintingPurchaseInvoicePdf,
  fetchPrintingPurchaseInvoices,
  type PrintingPurchaseInvoice,
} from "@/lib/printing-purchase-invoices";
import { fetchPurchaseOrders, type PurchaseOrder } from "@/lib/purchase-orders";
import {
  fetchPrintingPurchaseOrders,
  type PrintingPurchaseOrder,
} from "@/lib/printing-purchase-orders";
import { fetchVendorsList, type VendorOption } from "@/lib/vendors";
import styles from "@/styles/dashboard.module.css";

type View = "material" | "printing";
type ModalState =
  | { mode: "edit"; purchaseInvoice: PurchaseInvoice }
  | { mode: "printingEdit"; printingPurchaseInvoice: PrintingPurchaseInvoice }
  | null;
type LoadState = "loading" | "loaded";

export function PurchaseInvoicesTab() {
  const [view, setView] = useState<View>("material");
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [printingPurchaseInvoices, setPrintingPurchaseInvoices] = useState<PrintingPurchaseInvoice[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [printingPurchaseOrders, setPrintingPurchaseOrders] = useState<PrintingPurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [bulkFromDate, setBulkFromDate] = useState("");
  const [bulkToDate, setBulkToDate] = useState("");
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkDownloadError, setBulkDownloadError] = useState<string | null>(null);

  const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const printingPurchaseOrdersById = new Map(printingPurchaseOrders.map((po) => [po.id, po]));
  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  function loadAll() {
    return Promise.all([
      fetchPurchaseInvoices(),
      fetchPrintingPurchaseInvoices(),
      fetchPurchaseOrders(),
      fetchPrintingPurchaseOrders(),
      fetchVendorsList(),
    ]).then(
      ([
        purchaseInvoiceData,
        printingPurchaseInvoiceData,
        purchaseOrderData,
        printingPurchaseOrderData,
        vendorData,
      ]) => {
        setPurchaseInvoices(purchaseInvoiceData);
        setPrintingPurchaseInvoices(printingPurchaseInvoiceData);
        setPurchaseOrders(purchaseOrderData);
        setPrintingPurchaseOrders(printingPurchaseOrderData);
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

  function refreshPrintingPurchaseInvoices() {
    fetchPrintingPurchaseInvoices()
      .then(setPrintingPurchaseInvoices)
      .catch(() => {});
  }

  function handleSaved() {
    setModalState(null);
    refreshPurchaseInvoices();
  }

  function handlePrintingSaved() {
    setModalState(null);
    refreshPrintingPurchaseInvoices();
  }

  async function handleDownload(purchaseInvoice: PurchaseInvoice) {
    setDownloadError(null);
    try {
      await downloadUploadedPurchaseInvoicePdf(purchaseInvoice.id, purchaseInvoice.purchaseInvoiceNoDisplay);
    } catch {
      setDownloadError(
        `Couldn't download the PDF for purchase invoice ${purchaseInvoice.purchaseInvoiceNoDisplay}.`,
      );
    }
  }

  async function handleDownloadPrinting(printingPurchaseInvoice: PrintingPurchaseInvoice) {
    setDownloadError(null);
    try {
      await downloadUploadedPrintingPurchaseInvoicePdf(
        printingPurchaseInvoice.id,
        printingPurchaseInvoice.printingPurchaseInvoiceNoDisplay,
      );
    } catch {
      setDownloadError(
        `Couldn't download the PDF for printing purchase invoice ${printingPurchaseInvoice.printingPurchaseInvoiceNoDisplay}.`,
      );
    }
  }

  const isPrinting = view === "printing";

  // Zips whichever list is on screen: Material and Printing are separate
  // numbering series in separate collections, so there is no combined
  // download to offer.
  async function handleBulkDownload() {
    setBulkDownloadError(null);
    setBulkDownloading(true);
    try {
      if (isPrinting) {
        await downloadPrintingPurchaseInvoicesZip(bulkFromDate, bulkToDate);
      } else {
        await downloadPurchaseInvoicesZip(bulkFromDate, bulkToDate);
      }
    } catch (err) {
      setBulkDownloadError(err instanceof Error ? err.message : "Couldn't generate the invoices zip.");
    } finally {
      setBulkDownloading(false);
    }
  }

  // Clearing the error on a view switch keeps a "nothing in that range"
  // message from the other series off the screen — the button now means a
  // different list.
  function handleViewChange(next: View) {
    setView(next);
    setBulkDownloadError(null);
  }

  return (
    <>
      <div className={styles.invoicesToolbar}>
        <div className={styles.viewToggle} role="tablist" aria-label="Purchase invoice type">
          <button
            type="button"
            role="tab"
            aria-selected={!isPrinting}
            onClick={() => handleViewChange("material")}
            className={`${styles.viewToggleButton} ${!isPrinting ? styles.viewToggleButtonActive : ""}`}
          >
            Material
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isPrinting}
            onClick={() => handleViewChange("printing")}
            className={`${styles.viewToggleButton} ${isPrinting ? styles.viewToggleButtonActive : ""}`}
          >
            Printing
          </button>
        </div>
        <div className={styles.invoicesToolbarActions}>
          <div className={`${styles.invoicesFilterRow} ${styles.invoicesToolbarFilters}`}>
            <div className={styles.invoicesFilterField}>
              <label htmlFor="purchaseBulkFromDate" className={styles.formLabel}>
                From
              </label>
              <input
                id="purchaseBulkFromDate"
                type="date"
                value={bulkFromDate}
                onChange={(e) => setBulkFromDate(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div className={styles.invoicesFilterField}>
              <label htmlFor="purchaseBulkToDate" className={styles.formLabel}>
                To
              </label>
              <input
                id="purchaseBulkToDate"
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

      {!isPrinting && (
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
                      {/* The vendor's own document, and the only PDF this
                          record has. Nothing attached means nothing to
                          offer, so the row says so rather than showing a
                          button that can only 404 — attach one by
                          double-clicking the row. */}
                      {purchaseInvoice.hasUploadedPdf ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDownload(purchaseInvoice);
                          }}
                          className={styles.triggerButtonBase}
                        >
                          Download
                        </button>
                      ) : (
                        "—"
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
      )}

      {isPrinting && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Printing invoice no.</th>
                <th className={styles.tableHeadCell}>Date</th>
                <th className={styles.tableHeadCell}>Vendor</th>
                <th className={styles.tableHeadCell}>PO number</th>
                <th className={styles.tableHeadCell}>Amount</th>
                <th className={styles.tableHeadCell}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {printingPurchaseInvoices.map((printingPurchaseInvoice, index) => {
                const po = printingPurchaseInvoice.poId
                  ? printingPurchaseOrdersById.get(printingPurchaseInvoice.poId)
                  : undefined;
                return (
                  <tr
                    key={printingPurchaseInvoice.id}
                    onDoubleClick={() => setModalState({ mode: "printingEdit", printingPurchaseInvoice })}
                    className={styles.tableRow}
                  >
                    <td className={styles.tableCell}>{index + 1}</td>
                    <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                      {printingPurchaseInvoice.printingPurchaseInvoiceNoDisplay}
                    </td>
                    <td className={styles.tableCell}>
                      {new Date(printingPurchaseInvoice.date).toLocaleDateString()}
                    </td>
                    <td className={styles.tableCell}>
                      {vendorsById.get(printingPurchaseInvoice.vendorId)?.name ?? "—"}
                    </td>
                    <td className={styles.tableCell}>{po ? po.purchaseOrderNo : "—"}</td>
                    <td className={styles.tableCell}>
                      ₹{printingPurchaseInvoice.totalAmountAfterTax.toFixed(2)}
                    </td>
                    <td className={styles.tableCell}>
                      {/* No branded render to offer — the vendor's own
                          document is the whole of this record. A row with
                          nothing attached says so rather than showing a
                          button that can only 404. */}
                      {printingPurchaseInvoice.hasUploadedPdf ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDownloadPrinting(printingPurchaseInvoice);
                          }}
                          className={styles.triggerButtonBase}
                        >
                          Download
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loadState === "loading" && (
            <p className={styles.pageSubtext}>Loading printing purchase invoices…</p>
          )}
          {loadState === "loaded" && printingPurchaseInvoices.length === 0 && (
            <p className={styles.pageSubtext}>No printing purchase invoices raised yet.</p>
          )}
        </div>
      )}

      {modalState?.mode === "edit" && (
        <PurchaseInvoiceFormModal
          purchaseInvoice={modalState.purchaseInvoice}
          vendors={vendors}
          purchaseOrders={purchaseOrders}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
          onPdfAttached={refreshPurchaseInvoices}
        />
      )}

      {modalState?.mode === "printingEdit" && (
        <PrintingPurchaseInvoiceFormModal
          printingPurchaseInvoice={modalState.printingPurchaseInvoice}
          vendors={vendors}
          printingPurchaseOrders={printingPurchaseOrders}
          onClose={() => setModalState(null)}
          onSaved={handlePrintingSaved}
          onPdfAttached={refreshPrintingPurchaseInvoices}
        />
      )}
    </>
  );
}
