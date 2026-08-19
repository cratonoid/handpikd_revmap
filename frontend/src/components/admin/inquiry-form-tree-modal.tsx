"use client";

// ---------------------------------------------------------------------------
// <InquiryFormTreeModal> — popup shown when a row in the hamper inquiry form
// editor's categories table is double-clicked (inquiry-form-editor-tab.tsx)
// ---------------------------------------------------------------------------
// Same shape as category-tree-modal.tsx: shows the full hierarchy under one
// top-level category via <InquiryFormTreeNode>, which does the recursive
// rendering (and, unlike the plain category tree, also lets each node's own
// minimum amount/prompt/selection config be edited in place).
import { InquiryFormTreeNode } from "@/components/admin/inquiry-form-tree-node";
import type { InquiryNodeFormValues, InquiryTreeNode } from "@/lib/inquiry-form";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function InquiryFormTreeModal({
  node,
  onClose,
  onAddChild,
  onUpdate,
  onDelete,
}: {
  node: InquiryTreeNode;
  onClose: () => void;
  onAddChild: (parentId: number, values: InquiryNodeFormValues) => Promise<void>;
  onUpdate: (nodeId: number, values: InquiryNodeFormValues) => Promise<void>;
  onDelete: (nodeId: number) => Promise<void>;
}) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="inquiry-tree-modal-title"
        className={`${styles.modalPanel} ${styles.categoryTreeModalPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="inquiry-tree-modal-title" className={styles.modalTitle}>
              {node.label}
            </h2>
            <p className={styles.pageSubtext}>
              Browse the full hierarchy. Use the pencil to edit an option, + to add a sub-option, or x to delete.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.treeScrollArea}>
          <ul className={styles.treeRoot}>
            <InquiryFormTreeNode node={node} depth={0} onAddChild={onAddChild} onUpdate={onUpdate} onDelete={onDelete} />
          </ul>
        </div>
      </div>
    </div>
  );
}
