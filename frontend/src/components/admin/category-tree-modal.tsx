"use client";

// ---------------------------------------------------------------------------
// <CategoryTreeModal> — popup shown when a row in the categories table is
// clicked (components/admin/categories-page-client.tsx)
// ---------------------------------------------------------------------------
// Shows the full hierarchy under one parent category (children, grandchildren,
// ...) via <CategoryTreeNode>, which does the actual recursive rendering.
// Kept as a single wide-ish modal with its own scroll area (rather than a
// full page) since only one parent's subtree is being inspected/edited at a
// time.
import { CategoryTreeNode } from "@/components/admin/category-tree-node";
import type { CategoryNode } from "@/lib/categories";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function CategoryTreeModal({
  category,
  onClose,
  onAddChild,
  onDelete,
}: {
  category: CategoryNode;
  onClose: () => void;
  onAddChild: (parentId: string, name: string) => Promise<void>;
  onDelete: (categoryId: string) => Promise<void>;
}) {
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-tree-modal-title"
        className={`${styles.modalPanel} ${styles.categoryTreeModalPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="category-tree-modal-title" className={styles.modalTitle}>
              {category.name}
            </h2>
            <p className={styles.pageSubtext}>
              Browse the full category tree. Use + to add a category under a node, or x to delete one.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.treeScrollArea}>
          <ul className={styles.treeRoot}>
            <CategoryTreeNode node={category} depth={0} onAddChild={onAddChild} onDelete={onDelete} />
          </ul>
        </div>
      </div>
    </div>
  );
}
