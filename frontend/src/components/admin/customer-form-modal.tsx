"use client";

// ---------------------------------------------------------------------------
// <CustomerFormModal> — add/edit popup for the /admin/clients table
// ---------------------------------------------------------------------------
// One modal handles both flows:
//   - mode "add"  -> POST /admin/add_customer_details    (new user + customer)
//   - mode "edit" -> POST /admin/update_customer_details (existing customer,
//                    looked up by email — see backend/app/api/routes/admin.py)
// Both endpoints require the FULL record on every call (there's no PATCH),
// including a password — update_customer_details unconditionally overwrites
// the customer's login password with whatever is submitted, so the edit form
// asks for a new password too rather than leaving it blank.
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
  onSaved: (customer: Customer) => void;
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

  const isEdit = mode === "edit";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    const payload = {
      mail,
      password,
      registered_name: registeredName,
      company_or_department: companyOrDepartment,
      address,
      company_gst: companyGst,
      points,
      is_deleted: initialCustomer?.isDeleted ?? false,
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
          setError("A customer with this email already exists.");
        } else if (response.status === 404) {
          setError("Customer not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved({
        mail,
        registeredName,
        companyOrDepartment,
        address,
        companyGst,
        points,
        isDeleted: initialCustomer?.isDeleted ?? false,
        contacts,
      });
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
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
                Email
              </label>
              <input
                id="mail"
                type="email"
                required
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="password" className={styles.formLabel}>
                {isEdit ? "New password" : "Password"}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="registeredName" className={styles.formLabel}>
                Registered name
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
                Company / department
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

            <div>
              <label htmlFor="companyGst" className={styles.formLabel}>
                GST number
              </label>
              <input
                id="companyGst"
                type="text"
                required
                value={companyGst}
                onChange={(e) => setCompanyGst(e.target.value.toUpperCase())}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="points" className={styles.formLabel}>
                Starting points
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
                Address
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
              <span className={styles.formLabel}>Points of contact</span>
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
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={status === "saving"}>
              {status === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
