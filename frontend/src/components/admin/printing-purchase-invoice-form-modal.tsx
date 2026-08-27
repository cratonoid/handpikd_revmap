"use client";

// ---------------------------------------------------------------------------
// <PrintingPurchaseInvoiceFormModal> — edit popup on the Printing view of the
// Purchase Invoices tab
// ---------------------------------------------------------------------------
// The printing counterpart of purchase-invoice-form-modal.tsx, and edit-only
// for the same reason: a printing purchase invoice is raised automatically as
// part of creating its printing purchase order, so there is no "add" mode
// here and no create endpoint behind one.
//
// What's editable is just as narrow — the date, and void/restore, through
// POST /admin/update_printing_purchase_invoice_details. The order, vendor and
// amounts stay whatever the order said when the invoice was raised. The
// vendor's PDF is independent of all that and can be added or replaced at any
// time: picking a file uploads it immediately, which the backend treats as a
// replace, hard-deleting the old file with no history kept.
//
// The one thing missing versus the material popup is a branded PDF: this
// record IS the vendor's document, so the uploaded original is the only PDF
// it has.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { PrintingPurchaseOrder } from "@/lib/printing-purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import {
  attachPrintingPurchaseInvoicePdf,
  updatePrintingPurchaseInvoice,
  type PrintingPurchaseInvoice,
} from "@/lib/printing-purchase-invoices";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";
type PdfStatus = "idle" | "uploading";

export function PrintingPurchaseInvoiceFormModal({
  printingPurchaseInvoice,
  vendors,
  printingPurchaseOrders,
  onClose,
  onSaved,
  onPdfAttached,
}: {
  printingPurchaseInvoice: PrintingPurchaseInvoice;
  vendors: VendorOption[];
  printingPurchaseOrders: PrintingPurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
  // Fired after a PDF is attached/replaced, so the parent can refresh its
  // list's hasUploadedPdf state without closing the modal.
  onPdfAttached?: () => void;
}) {
  const [date, setDate] = useState(toDatetimeLocalValue(printingPurchaseInvoice.date));
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [hasUploadedPdf, setHasUploadedPdf] = useState(printingPurchaseInvoice.hasUploadedPdf);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const wasDeleted = printingPurchaseInvoice.isDeleted;

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));
  const purchaseOrder =
    printingPurchaseOrders.find((po) => po.id === printingPurchaseInvoice.poId) ?? null;
  const vendorName = vendorsById.get(printingPurchaseInvoice.vendorId)?.name ?? "—";

  async function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPdfStatus("uploading");
    setPdfError(null);
    try {
      await attachPrintingPurchaseInvoicePdf(printingPurchaseInvoice.id, file);
      setHasUploadedPdf(true);
      onPdfAttached?.();
    } catch {
      setPdfError("Failed to upload the PDF. Please try again.");
    } finally {
      setPdfStatus("idle");
    }
  }

  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    try {
      const response = await updatePrintingPurchaseInvoice({
        id: printingPurchaseInvoice.id,
        date: fromDatetimeLocalValue(date),
        isDeleted: isDeletedValue,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      onSaved();
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    void submitPayload(wasDeleted);
  }

  function handleDeleteOrRestore() {
    setConfirmingDelete(false);
    void submitPayload(!wasDeleted);
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="printing-purchase-invoice-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="printing-purchase-invoice-modal-title" className={styles.modalTitle}>
            Edit printing purchase invoice
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Printing purchase invoice no.</span>
              <p className={styles.pageSubtext}>
                {printingPurchaseInvoice.printingPurchaseInvoiceNoDisplay}
              </p>
            </div>

            <div>
              <span className={styles.formLabel}>Printing purchase order</span>
              <p className={styles.pageSubtext}>{purchaseOrder ? purchaseOrder.purchaseOrderNo : "—"}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Vendor</span>
              <p className={styles.pageSubtext}>{vendorName}</p>
            </div>

            {/* Only set for invoices whose order was created by uploading the
                vendor's PDF — it's the number printed on their document, not
                ours. */}
            {printingPurchaseInvoice.vendorInvoiceNo && (
              <div>
                <span className={styles.formLabel}>Vendor&apos;s invoice no.</span>
                <p className={styles.pageSubtext}>{printingPurchaseInvoice.vendorInvoiceNo}</p>
              </div>
            )}

            <div>
              <label htmlFor="printingPurchaseInvoiceDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="printingPurchaseInvoiceDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <span className={styles.formLabel}>Vendor PDF</span>
              <div>
                <label
                  className={`${styles.triggerButtonBase} ${styles.pdfUploadButton}`}
                  style={{ display: "inline-block", cursor: pdfStatus === "uploading" ? "default" : "pointer" }}
                >
                  {pdfStatus === "uploading" ? "Uploading…" : hasUploadedPdf ? "Replace file" : "Choose PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handlePdfChange}
                    disabled={pdfStatus === "uploading"}
                    style={{ display: "none" }}
                  />
                </label>
                {hasUploadedPdf && pdfStatus !== "uploading" && (
                  <p className={styles.pageSubtext}>Uploaded — download it from the list to check.</p>
                )}
                {pdfError && (
                  <p role="alert" aria-live="polite" className={styles.formError}>
                    {pdfError}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total before tax</p>
              <p className={styles.totalsRowValue}>
                ₹{printingPurchaseInvoice.totalAmountBeforeTax.toFixed(2)}
              </p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total tax</p>
              <p className={styles.totalsRowValue}>₹{printingPurchaseInvoice.totalTaxAmount.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total after tax</p>
              <p className={styles.totalsRowValue}>
                ₹{printingPurchaseInvoice.totalAmountAfterTax.toFixed(2)}
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {!confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${wasDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {wasDeleted ? "Restore invoice" : "Void invoice"}
                </button>
              )}

              {confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this printing purchase invoice?"
                      : "Are you sure you want to void this printing purchase invoice?"}
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={status === "saving"}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleDeleteOrRestore}
                    disabled={status === "saving"}
                  >
                    {status === "saving" ? "Saving…" : wasDeleted ? "Yes, restore" : "Yes, void"}
                  </Button>
                </div>
              )}
            </div>

            {!confirmingDelete && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={status === "saving"}>
                  {status === "saving" ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
