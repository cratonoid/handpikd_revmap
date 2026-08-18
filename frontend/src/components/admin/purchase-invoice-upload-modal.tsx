"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoiceUploadModal> — the "Upload invoice PDF" path of
// "+ New purchase order"
// ---------------------------------------------------------------------------
// Picking a file reads it immediately through POST
// /admin/parse_purchase_invoice_pdf (lib/purchase-orders.ts's
// parsePurchaseInvoicePdf). That call writes nothing: on success this hands
// the parsed values and the file itself back to the purchase orders tab,
// which opens the ordinary purchase order form pre-filled for review, and
// attaches the PDF to the purchase invoice once the order is saved.
//
// Failures are shown here rather than swallowed, because every one of them
// names something the admin has to fix first — a vendor or product that
// isn't on file, an invoice already recorded, mixed GST rates, a PDF that
// couldn't be read. From that state they can pick a different file or switch
// to filling the form in by hand.
import { useState, type ChangeEvent } from "react";
import { Button } from "@/components/button";
import { parsePurchaseInvoicePdf, type ParsedPurchaseInvoice } from "@/lib/purchase-orders";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "reading";

export function PurchaseInvoiceUploadModal({
  onParsed,
  onFillManually,
  onClose,
}: {
  // The file travels with the parsed values: it's attached to the purchase
  // invoice after the order saves, so it can't be discarded here.
  onParsed: (parsed: ParsedPurchaseInvoice, file: File) => void;
  onFillManually: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again after a failure still fires a
    // change event.
    event.target.value = "";
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setStatus("reading");

    try {
      const parsed = await parsePurchaseInvoicePdf(file);
      onParsed(parsed, file);
    } catch (parseError) {
      setError(
        parseError instanceof Error && parseError.message
          ? parseError.message
          : "Couldn't reach the server. Please try again.",
      );
      setStatus("idle");
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-invoice-upload-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="purchase-invoice-upload-title" className={styles.modalTitle}>
            Upload vendor invoice
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <p className={styles.pageSubtext}>
            The vendor must already exist with the GST number printed on the invoice, and every product on it
            must be in that vendor&apos;s catalogue.
          </p>

          <div>
            <label
              className={`${styles.triggerButtonBase} ${styles.pdfUploadButton}`}
              style={{ display: "inline-block", cursor: status === "reading" ? "default" : "pointer" }}
            >
              {status === "reading" ? "Reading invoice…" : fileName ? "Choose another PDF" : "Choose PDF"}
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                disabled={status === "reading"}
                style={{ display: "none" }}
              />
            </label>
            {fileName && <p className={styles.pageSubtext}>{fileName}</p>}
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              <button
                type="button"
                onClick={onFillManually}
                disabled={status === "reading"}
                className={styles.triggerButtonBase}
              >
                Fill in the details instead
              </button>
            </div>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={status === "reading"}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
