"use client";

// ---------------------------------------------------------------------------
// <InventoryHistoryDetailModal> — read-only popup opened by double-clicking
// a row on <InventoryHistoryTab>
// ---------------------------------------------------------------------------
// The history table itself only shows enough to identify a ledger entry
// (product, type, date) — this modal surfaces the rest (reference no., date,
// HSN, transaction type, quantity) on demand. There's nothing to
// edit here: InventoryHistory rows are written by app/services/inventory.py
// as the record of what stock each order currently holds, and are rewritten
// wholesale when that order is edited — never patched from this screen.
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import type { InventoryHistoryEntry } from "@/lib/inventory";
import styles from "@/styles/dashboard.module.css";

export function InventoryHistoryDetailModal({
  entry,
  productName,
  hsnCode,
  reference,
  onClose,
}: {
  entry: InventoryHistoryEntry;
  productName: string;
  hsnCode: string;
  reference: string;
  onClose: () => void;
}) {
  // Three types, not two: stock bought without a bill is its own kind of
  // purchase (see lib/inventory.ts's InventoryTransactionType), and saying
  // just "Purchase" would hide the one thing that matters about it.
  const transactionLabel =
    entry.transactionType === "purchase"
      ? "Purchase"
      : entry.transactionType === "unbilled_purchase"
        ? "Purchase (unbilled)"
        : "Sales";

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-history-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="inventory-history-modal-title" className={styles.modalTitle}>
            {transactionLabel} — {reference}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Date</span>
              <p className={styles.formStaticValue}>{new Date(entry.createdAt).toLocaleString()}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Transaction type</span>
              <p className={styles.formStaticValue}>{transactionLabel}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Product</span>
              <p className={styles.formStaticValue}>{productName}</p>
            </div>

            <div>
              <span className={styles.formLabel}>HSN</span>
              <p className={styles.formStaticValue}>{hsnCode}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Quantity</span>
              <p className={styles.formStaticValue}>{entry.quantity}</p>
            </div>
          </div>

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
