"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrderSourceModal> — the first step of "+ New purchase order"
// ---------------------------------------------------------------------------
// A purchase order can be started two ways, and they diverge enough to be
// worth asking up front rather than burying one inside the other's form:
//   - "Upload invoice PDF" reads the vendor's own invoice and fills the form
//     in (components/admin/purchase-invoice-upload-modal.tsx), so nothing is
//     keyed in twice.
//   - "Fill in the details" opens the same form empty
//     (components/admin/purchase-order-form-modal.tsx), which is the only
//     option for an order placed before its invoice arrives.
// Both paths end at the same form and the same save, and both raise the
// purchase order's purchase invoice — the upload path just arrives with the
// fields already filled and the PDF attached.
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function PurchaseOrderSourceModal({
  onChoose,
  onClose,
}: {
  onChoose: (source: "upload" | "manual") => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-order-source-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="purchase-order-source-title" className={styles.modalTitle}>
            New purchase order
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.sourceChoiceGrid}>
            <button type="button" onClick={() => onChoose("upload")} className={styles.sourceChoiceCard}>
              <span className={styles.sourceChoiceTitle}>Upload invoice PDF</span>
              <span className={styles.sourceChoiceHint}>
                Reads the vendor, date, products, quantities and GST off the vendor&apos;s own invoice, and
                attaches it to the purchase invoice. You review everything before it saves.
              </span>
            </button>

            <button type="button" onClick={() => onChoose("manual")} className={styles.sourceChoiceCard}>
              <span className={styles.sourceChoiceTitle}>Fill in the details</span>
              <span className={styles.sourceChoiceHint}>
                Key the order in yourself. A vendor invoice PDF can still be attached, but it&apos;s optional.
              </span>
            </button>
          </div>

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
