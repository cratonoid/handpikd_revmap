"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoiceFormModal> — edit popup on the Purchase Invoices tab
// ---------------------------------------------------------------------------
// Edit only: a purchase invoice is raised automatically as part of creating
// its purchase order (Purchase orders tab on /admin/orders — see
// services/purchase_invoices.py on the backend), so there is no "add" mode
// here and no create endpoint behind one.
//
// What's editable is deliberately narrow. The date and void/restore go
// through POST /admin/update_purchase_invoice_details; the purchase order,
// vendor and amounts stay whatever the order said when the invoice was
// raised. The vendor's own PDF is independent of all of that and can be
// added or replaced at any time: picking a file uploads it immediately
// (attachPurchaseInvoicePdf), which the backend also treats as a replace,
// hard-deleting the old file — there's no separate "confirm" step, and no
// history kept. All endpoints live in
// backend/app/api/routes/purchase_invoices.py.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { PurchaseOrder } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import {
  attachPurchaseInvoicePdf,
  updatePurchaseInvoice,
  type PurchaseInvoice,
} from "@/lib/purchase-invoices";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";
type PdfStatus = "idle" | "uploading";

export function PurchaseInvoiceFormModal({
  purchaseInvoice,
  vendors,
  purchaseOrders,
  onClose,
  onSaved,
  onPdfAttached,
}: {
  purchaseInvoice: PurchaseInvoice;
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
  // Fired after a PDF is attached/replaced, so the parent can refresh its
  // list's hasUploadedPdf state without closing the modal (the admin may
  // still be editing the date or about to void it).
  onPdfAttached?: () => void;
}) {
  const [date, setDate] = useState(toDatetimeLocalValue(purchaseInvoice.date));
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [hasUploadedPdf, setHasUploadedPdf] = useState(purchaseInvoice.hasUploadedPdf);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const wasDeleted = purchaseInvoice.isDeleted;

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));
  const purchaseOrder = purchaseOrders.find((po) => po.id === purchaseInvoice.poId) ?? null;
  const vendorName = vendorsById.get(purchaseInvoice.vendorId)?.name ?? "—";

  const totalTaxAmount = purchaseInvoice.totalAmountAfterTax - purchaseInvoice.totalAmountBeforeTax;

  async function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setPdfStatus("uploading");
    setPdfError(null);
    try {
      await attachPurchaseInvoicePdf(purchaseInvoice.id, file);
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
      const response = await updatePurchaseInvoice({
        id: purchaseInvoice.id,
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
        aria-labelledby="purchase-invoice-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="purchase-invoice-modal-title" className={styles.modalTitle}>
            Edit purchase invoice
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Purchase invoice no.</span>
              <p className={styles.pageSubtext}>{purchaseInvoice.purchaseInvoiceNoDisplay}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Purchase order</span>
              <p className={styles.pageSubtext}>{purchaseOrder ? `PO-${purchaseOrder.purchaseOrderNo}` : "—"}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Vendor</span>
              <p className={styles.pageSubtext}>{vendorName}</p>
            </div>

            {/* Only set for invoices whose purchase order was created by
                uploading the vendor's PDF — it's the number printed on their
                document, not ours. */}
            {purchaseInvoice.vendorInvoiceNo && (
              <div>
                <span className={styles.formLabel}>Vendor&apos;s invoice no.</span>
                <p className={styles.pageSubtext}>{purchaseInvoice.vendorInvoiceNo}</p>
              </div>
            )}

            <div>
              <label htmlFor="purchaseInvoiceDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="purchaseInvoiceDate"
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
              <p className={styles.totalsRowValue}>₹{purchaseInvoice.totalAmountBeforeTax.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total tax</p>
              <p className={styles.totalsRowValue}>₹{totalTaxAmount.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total after tax</p>
              <p className={styles.totalsRowValue}>₹{purchaseInvoice.totalAmountAfterTax.toFixed(2)}</p>
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
                      ? "Are you sure you want to restore this purchase invoice?"
                      : "Are you sure you want to void this purchase invoice?"}
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={status === "saving"}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleDeleteOrRestore} disabled={status === "saving"}>
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
