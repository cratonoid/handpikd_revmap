"use client";

// ---------------------------------------------------------------------------
// <ProfilePageClient> — the interactive body of /admin/profile
// ---------------------------------------------------------------------------
// Full-page view/edit form for Handpikd's own company profile, backed by
// GET /admin/get_profile_details and POST /admin/edit_profile_details
// (lib/profile-details.ts). Same #personal_details EAV table as the
// invoices tab's "Company details" modal (personal-details-modal.tsx /
// lib/personal-details.ts) — this page just exposes every attribute
// (including quotation_tnc/quotation_notes, not shown in that modal) under
// its own endpoint names, on its own page instead of a popup.
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fetchProfileDetails, updateProfileDetails } from "@/lib/profile-details";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded";
type SaveStatus = "idle" | "saving" | "saved";

const FIELD_KEYS = [
  "name",
  "gstin",
  "phone",
  "email",
  "website",
  "address",
  "bank_name",
  "bank_branch",
  "bank_account_name",
  "bank_account_no",
  "bank_ifsc",
  "qr_value",
  "invoice_tnc",
  "quotation_tnc",
  "quotation_notes",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];
type FieldValues = Record<FieldKey, string>;

const EMPTY_VALUES: FieldValues = FIELD_KEYS.reduce((acc, key) => {
  acc[key] = "";
  return acc;
}, {} as FieldValues);

export function ProfilePageClient() {
  const [values, setValues] = useState<FieldValues>(EMPTY_VALUES);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchProfileDetails()
      .then((data) => {
        if (cancelled) return;
        setValues((prev) => ({ ...prev, ...data }));
        setLoadState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load profile details.");
        setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function set(key: FieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveStatus("saving");
    setError(null);

    try {
      const response = await updateProfileDetails(values);
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        setSaveStatus("idle");
        return;
      }

      setSaveStatus("saved");
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setSaveStatus("idle");
    }
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Profile</h1>
          <p className={styles.pageSubtext}>View and edit Handpikd&apos;s company, bank, and document details.</p>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className={styles.pageSubtext}>Loading profile…</p>
      ) : (
        <div className={styles.profileCard}>
          <form onSubmit={handleSubmit} className={styles.profileCardBody}>
            <div className={styles.formGrid}>
              <div>
                <label htmlFor="profileName" className={styles.formLabel}>
                  Name
                </label>
                <input
                  id="profileName"
                  type="text"
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileGstin" className={styles.formLabel}>
                  GSTIN
                </label>
                <input
                  id="profileGstin"
                  type="text"
                  value={values.gstin}
                  onChange={(e) => set("gstin", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profilePhone" className={styles.formLabel}>
                  Phone
                </label>
                <input
                  id="profilePhone"
                  type="text"
                  value={values.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileEmail" className={styles.formLabel}>
                  Email
                </label>
                <input
                  id="profileEmail"
                  type="email"
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileWebsite" className={styles.formLabel}>
                  Website
                </label>
                <input
                  id="profileWebsite"
                  type="text"
                  value={values.website}
                  onChange={(e) => set("website", e.target.value)}
                  className={styles.formInput}
                />
              </div>
            </div>

            <div>
              <label htmlFor="profileAddress" className={styles.formLabel}>
                Address
              </label>
              <textarea
                id="profileAddress"
                rows={2}
                value={values.address}
                onChange={(e) => set("address", e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div className={styles.formGrid}>
              <div>
                <label htmlFor="profileBankName" className={styles.formLabel}>
                  Bank name
                </label>
                <input
                  id="profileBankName"
                  type="text"
                  value={values.bank_name}
                  onChange={(e) => set("bank_name", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileBankBranch" className={styles.formLabel}>
                  Bank branch
                </label>
                <input
                  id="profileBankBranch"
                  type="text"
                  value={values.bank_branch}
                  onChange={(e) => set("bank_branch", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileBankAccountName" className={styles.formLabel}>
                  Account name
                </label>
                <input
                  id="profileBankAccountName"
                  type="text"
                  value={values.bank_account_name}
                  onChange={(e) => set("bank_account_name", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileBankAccountNo" className={styles.formLabel}>
                  Account number
                </label>
                <input
                  id="profileBankAccountNo"
                  type="text"
                  value={values.bank_account_no}
                  onChange={(e) => set("bank_account_no", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileBankIfsc" className={styles.formLabel}>
                  IFSC
                </label>
                <input
                  id="profileBankIfsc"
                  type="text"
                  value={values.bank_ifsc}
                  onChange={(e) => set("bank_ifsc", e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div>
                <label htmlFor="profileQrValue" className={styles.formLabel}>
                  UPI payment link (QR)
                </label>
                <input
                  id="profileQrValue"
                  type="text"
                  placeholder="upi://pay?pa=..."
                  value={values.qr_value}
                  onChange={(e) => set("qr_value", e.target.value)}
                  className={styles.formInput}
                />
              </div>
            </div>

            <div>
              <label htmlFor="profileInvoiceTnc" className={styles.formLabel}>
                Invoice terms &amp; conditions (one per line)
              </label>
              <textarea
                id="profileInvoiceTnc"
                rows={3}
                value={values.invoice_tnc}
                onChange={(e) => set("invoice_tnc", e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div>
              <label htmlFor="profileQuotationTnc" className={styles.formLabel}>
                Quotation terms &amp; conditions (one per line)
              </label>
              <textarea
                id="profileQuotationTnc"
                rows={3}
                value={values.quotation_tnc}
                onChange={(e) => set("quotation_tnc", e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div>
              <label htmlFor="profileQuotationNotes" className={styles.formLabel}>
                Quotation notes (one per line)
              </label>
              <textarea
                id="profileQuotationNotes"
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
              <div className={styles.modalActionsLeft}>
                {saveStatus === "saved" && !error && <p className={styles.pageSubtext}>Saved.</p>}
              </div>
              <div className={styles.modalActionsRight}>
                <Button type="submit" variant="primary" disabled={saveStatus === "saving"}>
                  {saveStatus === "saving" ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
