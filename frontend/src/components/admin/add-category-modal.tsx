"use client";

// ---------------------------------------------------------------------------
// <AddCategoryModal> — popup opened by the "+ Add new category" button in
// the page header (components/admin/categories-page-client.tsx)
// ---------------------------------------------------------------------------
// Only creates a new TOP-LEVEL parent category (e.g. a new "Drinkware" row
// in the table). Adding children/sub-children under an existing parent
// happens via the "+" buttons inside the tree popup instead
// (category-tree-node.tsx) — this modal deliberately stays a single-field
// form. onAdd calls POST /admin/categories/add_category (see
// lib/categories.ts) and throws on failure, which is surfaced here instead
// of closing the modal.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function AddCategoryModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setStatus("saving");
    setError(null);
    try {
      await onAdd(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-category-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="add-category-modal-title" className={styles.modalTitle}>
            Add new category
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div>
            <label htmlFor="categoryName" className={styles.formLabel}>
              Category name
            </label>
            <input
              id="categoryName"
              type="text"
              autoFocus
              required
              placeholder="e.g. Drinkware"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.formInput}
            />
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={status === "saving"}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={status === "saving"}>
                {status === "saving" ? "Adding…" : "Add category"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
