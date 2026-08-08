"use client";

// ---------------------------------------------------------------------------
// <PersonalDetailsModal> — "Company details" settings popup on the Invoices tab
// ---------------------------------------------------------------------------
// Edit-only (no add/delete — personal_details is a fixed, always-seeded set
// of rows, see backend/app/services/personal_details.py). Renders one input
// per attribute this app actually uses today (letterhead + bank + invoice
// terms); quotation_tnc/quotation_notes belong to the not-yet-built
// quotations module and aren't shown here, but updatePersonalDetails only
// touches the keys it's given so they're left untouched.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { updatePersonalDetails } from "@/lib/personal-details";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function PersonalDetailsModal({
  initialValues,
  onClose,
  onSaved,
}: {
  initialValues: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState({
    name: initialValues.name ?? "",
    address: initialValues.address ?? "",
    gstin: initialValues.gstin ?? "",
    phone: initialValues.phone ?? "",
    email: initialValues.email ?? "",
    website: initialValues.website ?? "",
    bank_name: initialValues.bank_name ?? "",
    bank_branch: initialValues.bank_branch ?? "",
    bank_account_name: initialValues.bank_account_name ?? "",
    bank_account_no: initialValues.bank_account_no ?? "",
    bank_ifsc: initialValues.bank_ifsc ?? "",
    invoice_tnc: initialValues.invoice_tnc ?? "",
    qr_value: initialValues.qr_value ?? "",
  });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const response = await updatePersonalDetails(values);
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      onSaved();
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
        aria-labelledby="personal-details-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="personal-details-modal-title" className={styles.modalTitle}>
            Company details
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="companyName" className={styles.formLabel}>
                Name
              </label>
              <input
                id="companyName"
                type="text"
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="companyGstin" className={styles.formLabel}>
                GSTIN
              </label>
              <input
                id="companyGstin"
                type="text"
                value={values.gstin}
                onChange={(e) => set("gstin", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="companyPhone" className={styles.formLabel}>
                Phone
              </label>
              <input
                id="companyPhone"
                type="text"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="companyEmail" className={styles.formLabel}>
                Email
              </label>
              <input
                id="companyEmail"
                type="email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="companyWebsite" className={styles.formLabel}>
                Website
              </label>
              <input
                id="companyWebsite"
                type="text"
                value={values.website}
                onChange={(e) => set("website", e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div>
            <label htmlFor="companyAddress" className={styles.formLabel}>
              Address
            </label>
            <textarea
              id="companyAddress"
              rows={2}
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.formGrid}>
            <div>
              <label htmlFor="bankName" className={styles.formLabel}>
                Bank name
              </label>
              <input
                id="bankName"
                type="text"
                value={values.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="bankBranch" className={styles.formLabel}>
                Bank branch
              </label>
              <input
                id="bankBranch"
                type="text"
                value={values.bank_branch}
                onChange={(e) => set("bank_branch", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="bankAccountName" className={styles.formLabel}>
                Account name
              </label>
              <input
                id="bankAccountName"
                type="text"
                value={values.bank_account_name}
                onChange={(e) => set("bank_account_name", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="bankAccountNo" className={styles.formLabel}>
                Account number
              </label>
              <input
                id="bankAccountNo"
                type="text"
                value={values.bank_account_no}
                onChange={(e) => set("bank_account_no", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="bankIfsc" className={styles.formLabel}>
                IFSC
              </label>
              <input
                id="bankIfsc"
                type="text"
                value={values.bank_ifsc}
                onChange={(e) => set("bank_ifsc", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="qrValue" className={styles.formLabel}>
                UPI payment link (QR)
              </label>
              <input
                id="qrValue"
                type="text"
                placeholder="upi://pay?pa=..."
                value={values.qr_value}
                onChange={(e) => set("qr_value", e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div>
            <label htmlFor="invoiceTnc" className={styles.formLabel}>
              Invoice terms &amp; conditions (one per line)
            </label>
            <textarea
              id="invoiceTnc"
              rows={4}
              value={values.invoice_tnc}
              onChange={(e) => set("invoice_tnc", e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft} />
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={status === "saving"}>
                {status === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
