"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoiceFormModal> — add/edit popup on the Purchase Invoices tab
// ---------------------------------------------------------------------------
// Flow: a purchase order is created manually first (Purchase orders tab),
// then a purchase invoice is raised against it here — vendor and totals are
// snapshotted server-side from the chosen PO, never entered by hand.
//   mode "add"  -> POST /admin/create_new_purchase_invoice (date + poId).
//                  A vendor PDF is optional: if picked, it's attached in a
//                  second request (attachPurchaseInvoicePdf) once the invoice
//                  row exists — same two-phase pattern as catalogue-form-
//                  modal.tsx (see its header comment for why: bundling a
//                  file into the create request risked the same
//                  request-size blowup fixed for catalogues).
//   mode "edit" -> POST /admin/update_purchase_invoice_details (only date
//                  and void/restore are editable — po/vendor/amounts stay
//                  tied to whatever PO the invoice was raised against). The
//                  vendor PDF can be added or replaced independently at any
//                  time: picking a file uploads it immediately
//                  (attachPurchaseInvoicePdf), which the backend also uses
//                  to replace whatever PDF was there before (hard-deleting
//                  the old file) — there's no separate "confirm" step.
// All endpoints live in backend/app/api/routes/purchase_invoices.py.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { PurchaseOrder } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import {
  attachPurchaseInvoicePdf,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  type PurchaseInvoice,
} from "@/lib/purchase-invoices";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";
type PdfStatus = "idle" | "uploading";

export function PurchaseInvoiceFormModal({
  mode,
  initialPurchaseInvoice,
  vendors,
  purchaseOrders,
  onClose,
  onSaved,
  onPdfAttached,
}: {
  mode: "add" | "edit";
  initialPurchaseInvoice?: PurchaseInvoice;
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
  // Fired after a PDF is attached/replaced in edit mode, so the parent can
  // refresh its list's hasUploadedPdf state without closing the modal (the
  // admin may still be editing the date or about to void it).
  onPdfAttached?: () => void;
}) {
  const isEdit = mode === "edit";
  const title = isEdit ? "Edit purchase invoice" : "New purchase invoice";

  const [poId, setPoId] = useState<string | null>(
    initialPurchaseInvoice ? String(initialPurchaseInvoice.poId) : null,
  );
  const [date, setDate] = useState(
    initialPurchaseInvoice ? toDatetimeLocalValue(initialPurchaseInvoice.date) : nowAsDatetimeLocalValue(),
  );
  // Add mode only: held as the raw File so it can be sent to
  // attachPurchaseInvoicePdf once Save creates the invoice row.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  // Edit mode only: a picked file uploads immediately rather than waiting
  // for Save, since it's independent of the date/void fields below.
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [hasUploadedPdf, setHasUploadedPdf] = useState(initialPurchaseInvoice?.hasUploadedPdf ?? false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const wasDeleted = initialPurchaseInvoice?.isDeleted ?? false;

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));
  const poOptions: SingleSelectOption[] = purchaseOrders.map((po) => ({
    value: String(po.id),
    label: `PO-${po.purchaseOrderNo} — ${vendorsById.get(po.vendorId)?.name ?? "Unknown vendor"}`,
    isDeleted: false,
  }));
  const selectedPo = purchaseOrders.find((po) => String(po.id) === poId) ?? null;

  const vendorName = isEdit
    ? (vendorsById.get(initialPurchaseInvoice?.vendorId ?? -1)?.name ?? "—")
    : (selectedPo ? (vendorsById.get(selectedPo.vendorId)?.name ?? "—") : "—");

  const totalAmountBeforeTax = isEdit
    ? (initialPurchaseInvoice?.totalAmountBeforeTax ?? 0)
    : (selectedPo?.totalAmountBeforeTax ?? 0);
  const totalAmountAfterTax = isEdit
    ? (initialPurchaseInvoice?.totalAmountAfterTax ?? 0)
    : (selectedPo?.totalAmountAfterTax ?? 0);
  const totalTaxAmount = totalAmountAfterTax - totalAmountBeforeTax;

  function handleAddPdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPdfFile(file);
  }

  async function handleEditPdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !initialPurchaseInvoice) return;

    setPdfStatus("uploading");
    setPdfError(null);
    try {
      await attachPurchaseInvoicePdf(initialPurchaseInvoice.id, file);
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
      if (isEdit && initialPurchaseInvoice) {
        const response = await updatePurchaseInvoice({
          id: initialPurchaseInvoice.id,
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
        return;
      }

      const createResponse = await createPurchaseInvoice({
        date: fromDatetimeLocalValue(date),
        poId: Number(poId),
      });

      if (!createResponse.ok) {
        const detail = await createResponse.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      const { id: purchaseInvoiceId }: { id: number } = await createResponse.json();

      // The PDF is optional, so a failed attach here doesn't undo the
      // invoice that was just created — just surface it and let the admin
      // retry the upload from edit mode.
      if (pdfFile) {
        try {
          await attachPurchaseInvoicePdf(purchaseInvoiceId, pdfFile);
        } catch {
          setError("Purchase invoice created, but the PDF failed to upload. You can retry from Edit.");
        }
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

    if (!isEdit && !poId) {
      setError("Please select a purchase order.");
      return;
    }

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
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Purchase invoice no.</span>
              <p className={styles.pageSubtext}>
                {isEdit ? initialPurchaseInvoice?.purchaseInvoiceNoDisplay : "Assigned automatically on save"}
              </p>
            </div>

            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Purchase order</span>
                <p className={styles.pageSubtext}>{selectedPo ? `PO-${selectedPo.purchaseOrderNo}` : "—"}</p>
              </div>
            ) : (
              <SingleSelectDropdown
                label="Purchase order"
                placeholder="Select a purchase order"
                entityLabel="purchase orders"
                required
                showStatusFilter={false}
                options={poOptions}
                selectedValue={poId}
                onChange={setPoId}
              />
            )}

            <div>
              <span className={styles.formLabel}>Vendor</span>
              <p className={styles.pageSubtext}>{vendorName}</p>
            </div>

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
                {isEdit ? (
                  <>
                    <label
                      className={`${styles.triggerButtonBase} ${styles.pdfUploadButton}`}
                      style={{ display: "inline-block", cursor: pdfStatus === "uploading" ? "default" : "pointer" }}
                    >
                      {pdfStatus === "uploading" ? "Uploading…" : hasUploadedPdf ? "Replace file" : "Choose PDF"}
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleEditPdfChange}
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
                  </>
                ) : (
                  <>
                    <label
                      className={`${styles.triggerButtonBase} ${styles.pdfUploadButton}`}
                      style={{ display: "inline-block", cursor: "pointer" }}
                    >
                      {pdfFile ? "Replace file" : "Choose PDF (optional)"}
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleAddPdfChange}
                        style={{ display: "none" }}
                      />
                    </label>
                    {pdfFile && <p className={styles.pageSubtext}>Will be uploaded once you save.</p>}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total before tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountBeforeTax.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total tax</p>
              <p className={styles.totalsRowValue}>₹{totalTaxAmount.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total after tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountAfterTax.toFixed(2)}</p>
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {isEdit && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${wasDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {wasDeleted ? "Restore invoice" : "Void invoice"}
                </button>
              )}

              {isEdit && confirmingDelete && (
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
