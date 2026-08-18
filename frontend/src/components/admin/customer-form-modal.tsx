"use client";

// ---------------------------------------------------------------------------
// <CustomerFormModal> — add/edit popup for the /admin/clients table
// ---------------------------------------------------------------------------
// One modal handles both flows:
//   - mode "add"  -> POST /admin/add_customer_details    (new user + customer)
//   - mode "edit" -> POST /admin/update_customer_details (existing customer,
//                    looked up by email — see backend/app/api/routes/admin.py)
// Both endpoints require the FULL record on every call (there's no PATCH).
// In edit mode the email is editable, but it is still how the backend looks
// the customer up, so the payload carries both: `mail` stays the address the
// modal was opened with, and `new_mail` carries whatever the admin typed. The
// backend rejects a rename onto an address another user already holds with a
// 409, same as adding a duplicate. The password is optional: an empty string
// tells the backend to leave the current password alone.
//
// The delete/restore button reuses the same update_customer_details call
// with every other field held as-is and just `is_deleted` flipped — a soft
// delete, not a real removal, so it also works as an "undelete".
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import type { Customer, Contact } from "@/lib/customers";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function CustomerFormModal({
  mode,
  initialCustomer,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field except password.
  initialCustomer?: Customer;
  onClose: () => void;
  // `previousMail` is the address the customer had when the modal opened —
  // the table keys its rows by mail, so a rename has to update the right row
  // rather than look like a brand-new customer.
  onSaved: (customer: Customer, previousMail: string) => void;
}) {
  const [mail, setMail] = useState(initialCustomer?.mail ?? "");
  const [password, setPassword] = useState("");
  const [registeredName, setRegisteredName] = useState(initialCustomer?.registeredName ?? "");
  const [companyOrDepartment, setCompanyOrDepartment] = useState(initialCustomer?.companyOrDepartment ?? "");
  const [address, setAddress] = useState(initialCustomer?.address ?? "");
  const [companyGst, setCompanyGst] = useState(initialCustomer?.companyGst ?? "");
  const [points, setPoints] = useState(initialCustomer?.points ?? 0);
  const [contacts, setContacts] = useState<Contact[]>(
    initialCustomer?.contacts && initialCustomer.contacts.length > 0
      ? initialCustomer.contacts
      : [{ name: "", phone: "" }],
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialCustomer?.isDeleted ?? false;
  const title = isEdit ? "Edit customer" : "Add new customer";

  function updateContact(index: number, field: keyof Contact, value: string) {
    setContacts((prev) => prev.map((contact, i) => (i === index ? { ...contact, [field]: value } : contact)));
  }

  function addContactRow() {
    setContacts((prev) => [...prev, { name: "", phone: "" }]);
  }

  function removeContactRow(index: number) {
    setContacts((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Shared by the normal Save button and the delete/restore action below —
  // both just POST the current form state to update_customer_details, only
  // differing in what `is_deleted` should end up as.
  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    // Trimmed because the backend stores the trimmed address — keeping the
    // raw value locally would leave the table holding a mail the server
    // doesn't have, and the next edit of that row would 404.
    const submittedMail = mail.trim();

    const payload = {
      // Lookup key: in edit mode always the address the modal opened with,
      // since a rename must still find the existing user.
      mail: initialCustomer?.mail ?? submittedMail,
      ...(isEdit ? { new_mail: submittedMail } : {}),
      password,
      registered_name: registeredName,
      company_or_department: companyOrDepartment,
      address,
      company_gst: companyGst,
      points,
      is_deleted: isDeletedValue,
      contact_name: contacts.map((c) => c.name),
      contact_phone: contacts.map((c) => c.phone),
    };

    try {
      const response = await apiFetch(isEdit ? "/admin/update_customer_details" : "/admin/add_customer_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError(
            isEdit
              ? "Another customer already uses this email. Please pick a different one."
              : "A customer with this email already exists.",
          );
        } else if (response.status === 404) {
          setError("Customer not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved(
        {
          mail: submittedMail,
          registeredName,
          companyOrDepartment,
          address,
          companyGst,
          points,
          isDeleted: isDeletedValue,
          contacts,
        },
        initialCustomer?.mail ?? submittedMail,
      );
    } catch {
      setError("Couldn't reach the server. Please try again.");
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

    void submitPayload(wasDeleted);
  }

  function handleDeleteOrRestore() {
    setConfirmingDelete(false);
    void submitPayload(!wasDeleted);
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="customer-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="mail" className={styles.formLabel}>
                Email<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="mail"
                type="email"
                required
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                className={styles.formInput}
              />
              {isEdit && <p className={styles.pageSubtext}>This is the customer&apos;s login email.</p>}
            </div>

            <div>
              <label htmlFor="password" className={styles.formLabel}>
                {isEdit ? "New password" : "Password"}
                {!isEdit && <span className={styles.requiredMark}>*</span>}
              </label>
              <input
                id="password"
                type="password"
                required={!isEdit}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.formInput}
              />
              {isEdit && <p className={styles.pageSubtext}>Leave blank to keep the current password.</p>}
            </div>

            <div>
              <label htmlFor="registeredName" className={styles.formLabel}>
                Registered name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="registeredName"
                type="text"
                required
                value={registeredName}
                onChange={(e) => setRegisteredName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="companyOrDepartment" className={styles.formLabel}>
                Company / department<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="companyOrDepartment"
                type="text"
                required
                value={companyOrDepartment}
                onChange={(e) => setCompanyOrDepartment(e.target.value)}
                className={styles.formInput}
              />
            </div>

            {/* Optional: not every client is GST-registered, and the tax
                layer already treats a missing GSTIN as a real case rather
                than an error — is_intra_state (services/gst.py) reads "no
                buyer GSTIN" as inter-state and bills IGST, and the invoice
                PDF leaves Place of Supply blank. */}
            <div>
              <label htmlFor="companyGst" className={styles.formLabel}>
                GST number
              </label>
              <input
                id="companyGst"
                type="text"
                value={companyGst}
                onChange={(e) => setCompanyGst(e.target.value.toUpperCase())}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="points" className={styles.formLabel}>
                Starting points<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="points"
                type="number"
                min={0}
                required
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="address" className={styles.formLabel}>
                Address<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="address"
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={styles.formTextarea}
              />
            </div>
          </div>

          <div className={styles.contactsSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>
                Points of contact<span className={styles.requiredMark}>*</span>
              </span>
              <button type="button" onClick={addContactRow} className={styles.addContactButton}>
                + Add contact
              </button>
            </div>

            {contacts.map((contact, index) => (
              <div key={index} className={styles.contactRow}>
                <input
                  type="text"
                  placeholder="Contact name"
                  required
                  value={contact.name}
                  onChange={(e) => updateContact(index, "name", e.target.value)}
                  className={styles.formInput}
                  aria-label={`Contact ${index + 1} name`}
                />
                <input
                  type="tel"
                  placeholder="Contact phone"
                  required
                  value={contact.phone}
                  onChange={(e) => updateContact(index, "phone", e.target.value)}
                  className={styles.formInput}
                  aria-label={`Contact ${index + 1} phone`}
                />
                <button
                  type="button"
                  onClick={() => removeContactRow(index)}
                  disabled={contacts.length === 1}
                  aria-label={`Remove contact ${index + 1}`}
                  className={styles.removeContactButton}
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
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
                  className={`${styles.triggerButtonBase} ${wasDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {wasDeleted ? "Restore customer" : "Delete customer"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this customer?"
                      : "Are you sure you want to delete this customer?"}
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={status === "saving"}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={handleDeleteOrRestore} disabled={status === "saving"}>
                    {status === "saving" ? "Saving…" : wasDeleted ? "Yes, restore" : "Yes, delete"}
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
