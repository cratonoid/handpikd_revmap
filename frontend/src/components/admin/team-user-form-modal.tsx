"use client";

// ---------------------------------------------------------------------------
// <TeamUserFormModal> — add/edit popup for the Users tab of /admin/users
// ---------------------------------------------------------------------------
// A team user is an /admin login with a role (see role-form-modal.tsx for
// what a role grants). Adding needs a password; editing leaves it blank to
// keep the current one, same as the client form.
//
// "Active" unticked disables the account: it can't sign in, and any session
// it already has ends on its next request. That's the reversible option;
// Delete removes the login outright. Neither is offered on your own account,
// and the backend also refuses any change that would leave nobody on the
// Administrator role (routes/users.py) — its error is shown here as-is.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { addTeamUser, deleteTeamUser, updateTeamUser, UsersApiError, type Role, type TeamUser } from "@/lib/users";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function TeamUserFormModal({
  initialUser,
  roles,
  isSelf,
  onClose,
  onSaved,
}: {
  // Absent when adding a new user.
  initialUser?: TeamUser;
  roles: Role[];
  // True when editing the signed-in user's own account.
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialUser?.name ?? "");
  const [mail, setMail] = useState(initialUser?.mail ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<string>(initialUser?.roleId != null ? String(initialUser.roleId) : "");
  const [isActive, setIsActive] = useState(initialUser?.isActive ?? true);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = initialUser !== undefined;

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

    const payload = { name: name.trim(), mail: mail.trim(), password, roleId: Number(roleId), isActive };
    void run(() => (initialUser ? updateTeamUser(initialUser.id, payload) : addTeamUser(payload)));
  }

  function handleDelete() {
    setConfirmingDelete(false);
    if (initialUser) void run(() => deleteTeamUser(initialUser.id));
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-user-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="team-user-modal-title" className={styles.modalTitle}>
            {isEdit ? "Edit user" : "Add new user"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="teamUserName" className={styles.formLabel}>
                Name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="teamUserName"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="teamUserMail" className={styles.formLabel}>
                Email<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="teamUserMail"
                type="email"
                required
                autoComplete="off"
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                className={styles.formInput}
              />
              <p className={styles.pageSubtext}>They sign in with this email.</p>
            </div>

            <div>
              <label htmlFor="teamUserPassword" className={styles.formLabel}>
                {isEdit ? "New password" : "Password"}
                {!isEdit && <span className={styles.requiredMark}>*</span>}
              </label>
              <input
                id="teamUserPassword"
                type="password"
                required={!isEdit}
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.formInput}
              />
              <p className={styles.pageSubtext}>
                {isEdit ? "Leave blank to keep the current password." : "At least 8 characters."}
              </p>
            </div>

            <div>
              <label htmlFor="teamUserRole" className={styles.formLabel}>
                Role<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="teamUserRole"
                required
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className={styles.formInput}
              >
                <option value="">Select a role…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.isSystem ? `${role.name} (all sections)` : role.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="teamUserActive" className={styles.formCheckboxField}>
                <input
                  id="teamUserActive"
                  type="checkbox"
                  checked={isActive}
                  disabled={isSelf}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className={styles.selectCheckbox}
                />
                <span className={styles.formCheckboxText}>
                  <span className={styles.formCheckboxLabel}>Active</span>
                  <span className={styles.formCheckboxHint}>
                    {isSelf
                      ? "You can't disable your own account."
                      : "Unticking stops this user signing in and ends any session they have open. Their account stays here and can be re-enabled anytime."}
                  </span>
                </span>
              </label>
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {isEdit && !isSelf && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete user
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    Permanently delete this login? Disabling it is reversible; this isn&apos;t.
                  </span>
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
