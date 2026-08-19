"use client";

// ---------------------------------------------------------------------------
// <DatabaseLeadFormModal> — add/edit/delete popup for the /admin/database
// page's Leads tab
// ---------------------------------------------------------------------------
// Mirrors components/admin/database-vendor-form-modal.tsx — same modal shape,
// three fields instead of four, and no address/description split since a
// lead is just a contact + the institute they're attached to.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { addLead, deleteLead, updateLead, type Lead } from "@/lib/database";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function DatabaseLeadFormModal({
  mode,
  initialLead,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "add" | "edit";
  initialLead?: Lead;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
  onDeleted: (id: number) => void;
}) {
  const [name, setName] = useState(initialLead?.name ?? "");
  const [phone, setPhone] = useState(initialLead?.phone ?? "");
  const [instituteName, setInstituteName] = useState(initialLead?.instituteName ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit lead" : "Add new lead";

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
      if (isEdit && initialLead) {
        const lead = { id: initialLead.id, name, phone, instituteName };
        await updateLead(lead);
        onSaved(lead);
      } else {
        await addLead({ name, phone, instituteName });
        onSaved({ id: 0, name, phone, instituteName });
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  async function handleDelete() {
    if (!initialLead) return;
    setStatus("saving");
    setError(null);

    try {
      await deleteLead(initialLead.id);
      onDeleted(initialLead.id);
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
        aria-labelledby="database-lead-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="database-lead-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="leadName" className={styles.formLabel}>
                Name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="leadName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="leadPhone" className={styles.formLabel}>
                Phone number<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="leadPhone"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="leadInstituteName" className={styles.formLabel}>
                Institute name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="leadInstituteName"
                type="text"
                required
                value={instituteName}
                onChange={(e) => setInstituteName(e.target.value)}
                className={styles.formInput}
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
                  Delete lead
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>Are you sure you want to delete this lead?</span>
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
