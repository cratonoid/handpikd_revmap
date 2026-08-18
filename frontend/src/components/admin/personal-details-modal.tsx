"use client";

// ---------------------------------------------------------------------------
// <PersonalDetailsModal> — "Company details" settings popup on the Invoices tab
// ---------------------------------------------------------------------------
// Edit-only (no add/delete — personal_details is a fixed, always-seeded set
// of rows, see backend/app/services/personal_details.py). Renders one input
// per attribute this app actually uses today (letterhead + bank + invoice
// terms + quotation terms/notes, shared between invoices-tab.tsx and
// quotations-tab.tsx's "Company details" buttons) — updatePersonalDetails
// only touches the keys it's given, so opening this from either tab still
// round-trips every field shown here.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { resolveMediaUrl } from "@/lib/api";
import { updatePersonalDetails, uploadSignatureImage } from "@/lib/personal-details";
import { ArrowUpTrayIcon, DocumentTextIcon, XMarkIcon } from "@/components/icons";
import { GstStateSelect, useGstState } from "@/components/admin/gst-state-select";
import { stateNameForCode } from "@/lib/gst";
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
    company_name: initialValues.company_name ?? "",
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
    quotation_tnc: initialValues.quotation_tnc ?? "",
    quotation_notes: initialValues.quotation_notes ?? "",
    qr_value: initialValues.qr_value ?? "",
    signature_image: initialValues.signature_image ?? "",
  });
  // Our own state — the seller half of every SGST + CGST vs IGST decision
  // (see backend/app/services/gst.py). Follows the GSTIN as it's typed
  // until the admin picks a state themselves.
  const { stateCode, setStateCode, syncFromGstin } = useGstState(
    initialValues.state_code ?? "",
    initialValues.gstin ?? "",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [signatureUploadError, setSignatureUploadError] = useState<string | null>(null);

  function set(key: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Uploads immediately on file pick (see lib/personal-details.ts's
  // uploadSignatureImage) and stashes the returned /media URL into local
  // state — only persisted to personal_details once the form's Save button
  // is pressed, same two-step flow as product images.
  async function handleSignatureFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingSignature(true);
    setSignatureUploadError(null);

    try {
      const url = await uploadSignatureImage(file);
      set("signature_image", url);
    } catch {
      setSignatureUploadError("Couldn't upload signature. Please try again.");
    } finally {
      setIsUploadingSignature(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      // state_code/state_name live outside `values` (the dropdown owns
      // them), and state_name is derived here rather than kept in step by
      // hand so it can't drift from the code the tax split reads.
      const response = await updatePersonalDetails({
        ...values,
        state_code: stateCode,
        state_name: stateNameForCode(stateCode),
      });
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
                Company name
              </label>
              <input
                id="companyName"
                type="text"
                placeholder="Handpikd"
                value={values.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="contactName" className={styles.formLabel}>
                Contact name
              </label>
              <input
                id="contactName"
                type="text"
                placeholder="Person named on the invoice as the contact"
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
                onChange={(e) => {
                  set("gstin", e.target.value);
                  syncFromGstin(e.target.value);
                }}
                className={styles.formInput}
              />
            </div>

            {/* Every invoice is intra-state or inter-state relative to this
                one value; blank would bill every sale as IGST. */}
            <GstStateSelect id="companyState" value={stateCode} onChange={setStateCode} />

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

          <div className={styles.imagesSection}>
            <span className={styles.formLabel}>Signature (used on offline invoices)</span>
            <p className={styles.pageSubtext}>
              Shown on invoices marked &quot;offline&quot; in place of the &quot;system generated, no signature
              required&quot; note. Online invoices are unaffected.
            </p>
            <div className={styles.imageRow}>
              {values.signature_image ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset
                <img
                  src={resolveMediaUrl(values.signature_image)}
                  alt=""
                  className={styles.imageThumb}
                  onError={(e) => {
                    e.currentTarget.style.opacity = "0";
                  }}
                />
              ) : (
                <div className={styles.imageThumbEmpty}>
                  <DocumentTextIcon className="h-8 w-8" />
                </div>
              )}
              <label
                htmlFor="signatureUpload"
                className={`${styles.uploadImageButton} ${isUploadingSignature ? styles.uploadImageButtonDisabled : ""}`}
                aria-label="Upload signature image"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
              </label>
              <input
                id="signatureUpload"
                type="file"
                accept="image/*"
                onChange={(e) => void handleSignatureFileChange(e)}
                disabled={isUploadingSignature}
                className="sr-only"
              />
              {isUploadingSignature && <p className={styles.pageSubtext}>Uploading…</p>}
            </div>
            {signatureUploadError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {signatureUploadError}
              </p>
            )}
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

          <div>
            <label htmlFor="quotationTnc" className={styles.formLabel}>
              Quotation terms &amp; conditions (one per line)
            </label>
            <textarea
              id="quotationTnc"
              rows={4}
              value={values.quotation_tnc}
              onChange={(e) => set("quotation_tnc", e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          <div>
            <label htmlFor="quotationNotes" className={styles.formLabel}>
              Quotation notes (one per line)
            </label>
            <textarea
              id="quotationNotes"
              rows={3}
              value={values.quotation_notes}
              onChange={(e) => set("quotation_notes", e.target.value)}
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
