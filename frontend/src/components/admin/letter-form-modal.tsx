"use client";

// ---------------------------------------------------------------------------
// <LetterFormModal> — add/edit popup on /admin/letters
// ---------------------------------------------------------------------------
// Follows quotation-form-modal.tsx's flow:
//   - mode "add"  -> POST /admin/create_new_letter, then immediately
//                    downloads the generated PDF ("Generate letter").
//   - mode "edit" -> POST /admin/update_letter_details, with delete/restore.
// Both live in backend/app/api/routes/letters.py.
//
// The addressee is plain text. "Fill from client" copies a client's name and
// address into those fields as a starting point — it isn't a link, so the
// fields stay editable and a later change to the client doesn't touch a
// letter already sent.
//
// The body is free text: a blank line starts a new paragraph on the PDF, a
// single line break stays a line break (see services/letter_pdf.py).
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { nowAsDateValue, toDateValue } from "@/lib/datetime-input";
import { createLetter, downloadLetterPdf, updateLetter, type Letter } from "@/lib/letters";
import type { Customer } from "@/lib/customers";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const DEFAULT_SALUTATION = "Dear Sir/Madam,";
const DEFAULT_CLOSING = "Yours sincerely,";
const DEFAULT_DESIGNATION = "Authorised Signatory";

export function LetterFormModal({
  mode,
  initialLetter,
  customers,
  personalDetails,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialLetter?: Letter;
  customers: Customer[];
  // Only read for the new-letter defaults (signatory name, whether a
  // signature is on file) — the letterhead itself is filled in server-side.
  personalDetails: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(initialLetter ? toDateValue(initialLetter.date) : nowAsDateValue());
  const [prefillCustomerId, setPrefillCustomerId] = useState<string | null>(null);
  const [recipientName, setRecipientName] = useState(initialLetter?.recipientName ?? "");
  const [recipientAddress, setRecipientAddress] = useState(initialLetter?.recipientAddress ?? "");
  const [subject, setSubject] = useState(initialLetter?.subject ?? "");
  const [salutation, setSalutation] = useState(initialLetter?.salutation ?? DEFAULT_SALUTATION);
  const [body, setBody] = useState(initialLetter?.body ?? "");
  const [closing, setClosing] = useState(initialLetter?.closing ?? DEFAULT_CLOSING);
  const [signatoryName, setSignatoryName] = useState(initialLetter?.signatoryName ?? personalDetails.name ?? "");
  const [signatoryDesignation, setSignatoryDesignation] = useState(
    initialLetter?.signatoryDesignation ?? DEFAULT_DESIGNATION,
  );
  const [includeSignature, setIncludeSignature] = useState(initialLetter?.includeSignature ?? false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialLetter?.isDeleted ?? false;
  const title = isEdit ? "Edit letter" : "New letter";
  const hasSignatureOnFile = Boolean(personalDetails.signature_image);

  const customerOptions: SingleSelectOption[] = customers
    .filter((customer) => !customer.isDeleted)
    .map((customer) => ({
      value: String(customer.id),
      label: customer.companyOrDepartment
        ? `${customer.registeredName} · ${customer.companyOrDepartment}`
        : customer.registeredName,
      isDeleted: false,
    }));

  function handlePrefill(customerId: string) {
    setPrefillCustomerId(customerId);
    const customer = customers.find((c) => String(c.id) === customerId);
    if (!customer) return;
    setRecipientName(customer.registeredName);
    setRecipientAddress(
      [customer.companyOrDepartment, customer.address].filter((line) => line.trim()).join("\n"),
    );
  }

  function buildPayload() {
    return {
      date,
      recipientName: recipientName.trim(),
      recipientAddress,
      subject,
      salutation,
      body,
      closing,
      signatoryName,
      signatoryDesignation,
      includeSignature,
    };
  }

  async function submitEdit(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    try {
      const response = await updateLetter({ id: initialLetter!.id, isDeleted: isDeletedValue, ...buildPayload() });

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

  async function submitCreateAndGenerate() {
    setStatus("saving");
    setError(null);

    try {
      const { id, letterNo } = await createLetter(buildPayload());

      try {
        await downloadLetterPdf(id, letterNo);
      } catch {
        // The letter was saved — its PDF can be re-downloaded from the table.
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    // `required` alone lets a whitespace-only body through; the backend
    // rejects that, so catch it here with a clearer message.
    if (!body.trim()) {
      setError("Please write the body of the letter.");
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    void (isEdit ? submitEdit(wasDeleted) : submitCreateAndGenerate());
  }

  function handleDeleteOrRestore() {
    setConfirmingDelete(false);
    void submitEdit(!wasDeleted);
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="letter-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="letter-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Ref no.</span>
              <p className={styles.pageSubtext}>{isEdit ? initialLetter?.letterNo : "Assigned automatically on save"}</p>
            </div>

            <div>
              <label htmlFor="letterDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="letterDate"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <SingleSelectDropdown
                label="Fill from client (optional)"
                placeholder="Pick a client to copy their name and address"
                entityLabel="clients"
                showStatusFilter={false}
                options={customerOptions}
                selectedValue={prefillCustomerId}
                onChange={handlePrefill}
              />
            </div>

            <div>
              <label htmlFor="letterRecipientName" className={styles.formLabel}>
                To<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="letterRecipientName"
                type="text"
                required
                placeholder="e.g. The Branch Manager"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="letterSubject" className={styles.formLabel}>
                Subject
              </label>
              <input
                id="letterSubject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="letterRecipientAddress" className={styles.formLabel}>
                Address (one line per row)
              </label>
              <textarea
                id="letterRecipientAddress"
                rows={3}
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="letterSalutation" className={styles.formLabel}>
                Salutation
              </label>
              <input
                id="letterSalutation"
                type="text"
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="letterBody" className={styles.formLabel}>
                Body<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="letterBody"
                rows={12}
                required
                placeholder="Leave a blank line between paragraphs."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div>
              <label htmlFor="letterClosing" className={styles.formLabel}>
                Closing
              </label>
              <input
                id="letterClosing"
                type="text"
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="letterSignatoryName" className={styles.formLabel}>
                Signed by
              </label>
              <input
                id="letterSignatoryName"
                type="text"
                value={signatoryName}
                onChange={(e) => setSignatoryName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="letterSignatoryDesignation" className={styles.formLabel}>
                Designation
              </label>
              <input
                id="letterSignatoryDesignation"
                type="text"
                value={signatoryDesignation}
                onChange={(e) => setSignatoryDesignation(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="letterIncludeSignature" className={styles.formCheckboxField}>
                <input
                  id="letterIncludeSignature"
                  type="checkbox"
                  checked={includeSignature}
                  onChange={(e) => setIncludeSignature(e.target.checked)}
                  className={styles.selectCheckbox}
                />
                <span className={styles.formCheckboxText}>
                  <span className={styles.formCheckboxLabel}>Include signature</span>
                  <span className={styles.formCheckboxHint}>
                    {hasSignatureOnFile
                      ? "Prints the scanned signature from Company details above the signatory's name."
                      : "No signature uploaded yet — add one under Company details, or leave this off to sign by hand."}
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
              {isEdit && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${wasDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {wasDeleted ? "Restore letter" : "Delete letter"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this letter?"
                      : "Are you sure you want to delete this letter?"}
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
                  {status === "saving"
                    ? isEdit
                      ? "Saving…"
                      : "Generating…"
                    : isEdit
                      ? "Save"
                      : "Generate letter"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
