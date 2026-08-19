"use client";

// ---------------------------------------------------------------------------
// <InquiryNodeFormModal> — shared add/edit popup for one node in the hamper
// inquiry form hierarchy (components/admin/inquiry-form-tree-node.tsx,
// inquiry-form-editor-tab.tsx)
// ---------------------------------------------------------------------------
// One modal handles both "add a new option" (mode="add", no initialValues)
// and "edit this option" (mode="edit", initialValues from the node being
// edited) — same idea as product-form-modal.tsx. `is_active` only makes
// sense once a node exists (new nodes always start active — see add_node in
// the backend), so that field is hidden in "add" mode.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import type { InquiryNodeFormValues } from "@/lib/inquiry-form";
import styles from "@/styles/dashboard.module.css";

const DEFAULT_VALUES: InquiryNodeFormValues = {
  label: "",
  minAmount: "",
  prompt: "",
  selectionMode: "multi",
  maxSelections: "",
  sortOrder: 0,
  isActive: true,
};

export function InquiryNodeFormModal({
  mode,
  title,
  initialValues,
  onClose,
  onSubmit,
}: {
  mode: "add" | "edit";
  title: string;
  initialValues?: InquiryNodeFormValues;
  onClose: () => void;
  onSubmit: (values: InquiryNodeFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<InquiryNodeFormValues>(initialValues ?? DEFAULT_VALUES);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.label.trim()) return;

    setStatus("saving");
    setError(null);
    try {
      await onSubmit(values);
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
        aria-labelledby="inquiry-node-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="inquiry-node-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="nodeLabel" className={styles.formLabel}>
                Label<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="nodeLabel"
                type="text"
                autoFocus
                required
                placeholder="e.g. Headphone"
                value={values.label}
                onChange={(e) => setValues((prev) => ({ ...prev, label: e.target.value }))}
                className={styles.formInput}
              />
            </div>
            <div>
              <label htmlFor="nodeMinAmount" className={styles.formLabel}>
                Minimum amount (₹) <span className={styles.formOptionalText}>(optional)</span>
              </label>
              <input
                id="nodeMinAmount"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 600"
                value={values.minAmount}
                onChange={(e) => setValues((prev) => ({ ...prev, minAmount: e.target.value }))}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="nodePrompt" className={styles.formLabel}>
                Heading shown above its sub-options <span className={styles.formOptionalText}>(optional)</span>
              </label>
              <input
                id="nodePrompt"
                type="text"
                placeholder='e.g. "Any preferred brand in mind:"'
                value={values.prompt}
                onChange={(e) => setValues((prev) => ({ ...prev, prompt: e.target.value }))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="nodeSelectionMode" className={styles.formLabel}>
                How its sub-options are picked
              </label>
              <select
                id="nodeSelectionMode"
                value={values.selectionMode}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, selectionMode: e.target.value as "single" | "multi" }))
                }
                className={styles.formInput}
              >
                <option value="multi">Multiple (checkboxes)</option>
                <option value="single">Single (pick one)</option>
              </select>
            </div>

            {values.selectionMode === "multi" && (
              <div>
                <label htmlFor="nodeMaxSelections" className={styles.formLabel}>
                  Max sub-options selectable <span className={styles.formOptionalText}>(optional)</span>
                </label>
                <input
                  id="nodeMaxSelections"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="No limit"
                  value={values.maxSelections}
                  onChange={(e) => setValues((prev) => ({ ...prev, maxSelections: e.target.value }))}
                  className={styles.formInput}
                />
              </div>
            )}

            <div>
              <label htmlFor="nodeSortOrder" className={styles.formLabel}>
                Sort order
              </label>
              <input
                id="nodeSortOrder"
                type="number"
                step={1}
                value={values.sortOrder}
                onChange={(e) => setValues((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                className={styles.formInput}
              />
            </div>

            {mode === "edit" && (
              <div>
                <label htmlFor="nodeIsActive" className={styles.formLabel}>
                  Visible on public form
                </label>
                <select
                  id="nodeIsActive"
                  value={values.isActive ? "active" : "inactive"}
                  onChange={(e) => setValues((prev) => ({ ...prev, isActive: e.target.value === "active" }))}
                  className={styles.formInput}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}
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
                {status === "saving" ? "Saving…" : mode === "add" ? "Add option" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
