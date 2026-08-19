"use client";

// ---------------------------------------------------------------------------
// <DatabaseVendorFormModal> — add/edit/delete popup for the /admin/database
// page's Vendors tab
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendor-form-modal.tsx in structure, but this
// directory's delete is a real removal (DELETE /admin/database/delete_vendor)
// rather than the richer vendors module's soft-delete/restore flag — there's
// nothing else in the app that references a database-vendor row, so there's
// no reason to keep a deleted one around.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { addDatabaseVendor, deleteDatabaseVendor, updateDatabaseVendor, type DatabaseVendor } from "@/lib/database";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function DatabaseVendorFormModal({
  mode,
  initialVendor,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "add" | "edit";
  initialVendor?: DatabaseVendor;
  onClose: () => void;
  onSaved: (vendor: DatabaseVendor) => void;
  onDeleted: (id: number) => void;
}) {
  const [name, setName] = useState(initialVendor?.name ?? "");
  const [phone, setPhone] = useState(initialVendor?.phone ?? "");
  const [address, setAddress] = useState(initialVendor?.address ?? "");
  const [description, setDescription] = useState(initialVendor?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit vendor" : "Add new vendor";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      if (isEdit && initialVendor) {
        const vendor = { id: initialVendor.id, name, phone, address, description };
        await updateDatabaseVendor(vendor);
        onSaved(vendor);
      } else {
        await addDatabaseVendor({ name, phone, address, description });
        onSaved({ id: 0, name, phone, address, description });
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  async function handleDelete() {
    if (!initialVendor) return;
    setStatus("saving");
    setError(null);

    try {
      await deleteDatabaseVendor(initialVendor.id);
      onDeleted(initialVendor.id);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
      setConfirmingDelete(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-vendor-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="database-vendor-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="vendorName" className={styles.formLabel}>
                Name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="vendorName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="vendorPhone" className={styles.formLabel}>
                Phone number<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="vendorPhone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="vendorAddress" className={styles.formLabel}>
                Address<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="vendorAddress"
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="vendorDescription" className={styles.formLabel}>
                Description<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="vendorDescription"
                required
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={styles.formTextarea}
              />
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
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete vendor
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>Are you sure you want to delete this vendor?</span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={status === "saving"}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleDelete} disabled={status === "saving"}>
                    {status === "saving" ? "Deleting…" : "Yes, delete"}
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
