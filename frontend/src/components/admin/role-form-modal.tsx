"use client";

// ---------------------------------------------------------------------------
// <RoleFormModal> — add/edit popup for the Roles tab of /admin/users
// ---------------------------------------------------------------------------
// A role is a name and a set of sections (lib/access.ts's ADMIN_SECTIONS, one
// checkbox each). Users on the role see only those sections in the sidebar,
// and the backend refuses their requests to any other (require_section in
// backend/app/api/deps.py).
//
// Delete is offered only in edit mode, and the backend refuses it while any
// user still has the role — the error it returns says so, and is shown here.
// The built-in Administrator role never reaches this modal: it has every
// section and can't be changed (see users-page-client.tsx).
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { ADMIN_SECTIONS, type SectionKey } from "@/lib/access";
import { addRole, deleteRole, updateRole, UsersApiError, type Role } from "@/lib/users";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function RoleFormModal({
  initialRole,
  onClose,
  onSaved,
}: {
  // Absent when adding a new role.
  initialRole?: Role;
  onClose: () => void;
  // The page reloads roles and users after any change, since a rename also
  // changes the role name shown against every user who has it.
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialRole?.name ?? "");
  const [sections, setSections] = useState<Set<SectionKey>>(new Set(initialRole?.sections ?? []));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = initialRole !== undefined;
  const allChecked = sections.size === ADMIN_SECTIONS.length;

  function toggleSection(key: SectionKey, checked: boolean) {
    setSections((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAll() {
    setSections(allChecked ? new Set() : new Set(ADMIN_SECTIONS.map((section) => section.key)));
  }

  async function run(action: () => Promise<void>) {
    setStatus("saving");
    setError(null);
    try {
      await action();
      onSaved();
    } catch (caught) {
      setError(caught instanceof UsersApiError ? caught.message : "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    // Sent in sidebar order; the backend normalises it anyway.
    const payload = {
      name: name.trim(),
      sections: ADMIN_SECTIONS.map((section) => section.key).filter((key) => sections.has(key)),
    };
    void run(() => (initialRole ? updateRole(initialRole.id, payload) : addRole(payload)));
  }

  function handleDelete() {
    setConfirmingDelete(false);
    if (initialRole) void run(() => deleteRole(initialRole.id));
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="role-modal-title" className={styles.modalTitle}>
            {isEdit ? "Edit role" : "Add new role"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="roleName" className={styles.formLabel}>
                Role name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="roleName"
                type="text"
                required
                placeholder="e.g. Sales, Accounts, Warehouse"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div role="group" aria-labelledby="role-sections-label" className={styles.contactsSection}>
            <div className={styles.contactsHeader}>
              <span id="role-sections-label" className={styles.formLabel}>
                Sections this role can open
              </span>
              <button type="button" onClick={toggleAll} className={styles.addContactButton}>
                {allChecked ? "Clear all" : "Select all"}
              </button>
            </div>

            <div className={styles.sectionChecklist}>
              {ADMIN_SECTIONS.map((section) => (
                <label key={section.key} className={styles.sectionChecklistItem}>
                  <input
                    type="checkbox"
                    checked={sections.has(section.key)}
                    onChange={(e) => toggleSection(section.key, e.target.checked)}
                    className={styles.selectCheckbox}
                  />
                  <span>{section.label}</span>
                </label>
              ))}
            </div>

            {sections.has("users") && (
              <p className={styles.formHint}>
                Users &amp; Roles lets anyone on this role add users and change what every role can open.
              </p>
            )}
            {sections.size === 0 && (
              <p className={styles.formHint}>With no sections ticked, users on this role can sign in but see nothing.</p>
            )}
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
                  Delete role
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>Are you sure you want to delete this role?</span>
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
