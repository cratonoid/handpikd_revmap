"use client";

// ---------------------------------------------------------------------------
// <ContactFormModal> — add/edit popup for the /admin/database tabs
// ---------------------------------------------------------------------------
// One form for clients, leads and vendors (components/admin/
// database-page-client.tsx): name and phone are required, email is
// optional, and vendors get three more optional fields — type, description
// and location. "add" mode starts blank; "edit" mode is pre-filled from the
// row. Saving goes through lib/database-contacts.ts and any backend error is
// shown here instead of closing the modal.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import {
  addContact,
  updateContact,
  type Contact,
  type ContactFields,
  type ContactType,
} from "@/lib/database-contacts";
import styles from "@/styles/dashboard.module.css";

const EMPTY_FIELDS: ContactFields = {
  name: "",
  email: "",
  phone: "",
  vendorType: "",
  description: "",
  location: "",
};

// Loose on purpose: only catches obvious typos. The backend applies the same
// check (routes/database_contacts.py, _clean_email).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export function ContactFormModal({
  type,
  typeLabel,
  initialContact,
  onClose,
  onSaved,
}: {
  type: ContactType;
  // Singular, lower-case: "client", "lead" or "vendor".
  typeLabel: string;
  // Present in edit mode, absent in add mode.
  initialContact?: Contact;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}) {
  const isEdit = initialContact !== undefined;
  const isVendor = type === "vendor";

  const [fields, setFields] = useState<ContactFields>(() =>
    initialContact
      ? {
          name: initialContact.name,
          email: initialContact.email,
          phone: initialContact.phone,
          vendorType: initialContact.vendorType,
          description: initialContact.description,
          location: initialContact.location,
        }
      : EMPTY_FIELDS,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: keyof ContactFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed: ContactFields = {
      name: fields.name.trim(),
      email: fields.email.trim(),
      phone: fields.phone.trim(),
      vendorType: isVendor ? fields.vendorType.trim() : "",
      description: isVendor ? fields.description.trim() : "",
      location: isVendor ? fields.location.trim() : "",
    };
    if (!trimmed.name) {
      setError("Enter a name.");
      return;
    }
    if (!trimmed.phone) {
      setError("Enter a phone number.");
      return;
    }
    if (trimmed.email && !EMAIL_PATTERN.test(trimmed.email)) {
      setError("That email address doesn't look right.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = initialContact
        ? await updateContact(initialContact.id, trimmed)
        : await addContact(type, trimmed);
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="contact-modal-title" className={styles.modalTitle}>
            {isEdit ? `Edit ${typeLabel}` : `Add ${typeLabel}`}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm} noValidate>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="contactName" className={styles.formLabel}>
                Name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="contactName"
                type="text"
                autoFocus
                required
                value={fields.name}
                onChange={(event) => setField("name", event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </div>
            <div>
              <label htmlFor="contactPhone" className={styles.formLabel}>
                Phone no.<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="contactPhone"
                type="tel"
                required
                inputMode="tel"
                value={fields.phone}
                onChange={(event) => setField("phone", event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </div>
            <div>
              <label htmlFor="contactEmail" className={styles.formLabel}>
                Email
              </label>
              <input
                id="contactEmail"
                type="email"
                value={fields.email}
                onChange={(event) => setField("email", event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </div>

            {isVendor && (
              <>
                <div>
                  <label htmlFor="contactVendorType" className={styles.formLabel}>
                    Type
                  </label>
                  <input
                    id="contactVendorType"
                    type="text"
                    placeholder="e.g. Printing, Packaging"
                    value={fields.vendorType}
                    onChange={(event) => setField("vendorType", event.target.value)}
                    className={styles.formInput}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label htmlFor="contactLocation" className={styles.formLabel}>
                    Location
                  </label>
                  <input
                    id="contactLocation"
                    type="text"
                    value={fields.location}
                    onChange={(event) => setField("location", event.target.value)}
                    className={styles.formInput}
                    disabled={saving}
                  />
                </div>
                <div className={styles.formGridFullSpan}>
                  <label htmlFor="contactDescription" className={styles.formLabel}>
                    Description
                  </label>
                  <textarea
                    id="contactDescription"
                    rows={3}
                    value={fields.description}
                    onChange={(event) => setField("description", event.target.value)}
                    className={styles.formTextarea}
                    disabled={saving}
                  />
                </div>
              </>
            )}
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Save changes" : `Add ${typeLabel}`}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
