"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrderSourceModal> — the first step of "+ New purchase order"
// ---------------------------------------------------------------------------
// A purchase order can be started two ways, and they diverge enough to be
// worth asking up front rather than burying one inside the other's form:
//   - "Upload invoice PDF" reads the vendor's own invoice and fills the form
//     in, so nothing is keyed in twice.
//   - "Fill in the details" opens the same form empty, which is the only
//     option for an order placed before its invoice arrives.
// Both paths end at the same form and the same save, and both raise the
// order's purchase invoice — the upload path just arrives with the fields
// already filled and the PDF attached.
//
// Shared by both kinds of purchase order, since the choice itself is
// identical either way. `kind` only changes the wording: a material order's
// upload path resolves the invoice's lines against the vendor's product
// catalogue, and a printing one has no catalogue to resolve against at all
// (see components/admin/printing-purchase-order-form-modal.tsx), which is
// the one thing the admin should know before picking.
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

const COPY = {
  material: {
    title: "New purchase order",
    uploadHint:
      "Reads the vendor, date, products, quantities and GST off the vendor's own invoice, and attaches it to the purchase invoice. You review everything before it saves.",
    manualHint: "Key the order in yourself. A vendor invoice PDF can still be attached, but it's optional.",
  },
  printing: {
    title: "New printing purchase order",
    uploadHint:
      "Reads the vendor, date, services, quantities and GST off the printing vendor's own invoice, and attaches it to the printing purchase invoice. You review everything before it saves.",
    manualHint:
      "Key the order in yourself. A vendor invoice PDF can still be attached, but it's optional. Nothing here touches products or stock.",
  },
} as const;

export function PurchaseOrderSourceModal({
  kind = "material",
  onChoose,
  onClose,
}: {
  kind?: "material" | "printing";
  onChoose: (source: "upload" | "manual") => void;
  onClose: () => void;
}) {
  const copy = COPY[kind];

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
            {copy.title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.sourceChoiceGrid}>
            <button type="button" onClick={() => onChoose("upload")} className={styles.sourceChoiceCard}>
              <span className={styles.sourceChoiceTitle}>Upload invoice PDF</span>
              <span className={styles.sourceChoiceHint}>{copy.uploadHint}</span>
            </button>

            <button type="button" onClick={() => onChoose("manual")} className={styles.sourceChoiceCard}>
              <span className={styles.sourceChoiceTitle}>Fill in the details</span>
              <span className={styles.sourceChoiceHint}>{copy.manualHint}</span>
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
