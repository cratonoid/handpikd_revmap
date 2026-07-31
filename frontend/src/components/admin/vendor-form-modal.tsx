"use client";

// ---------------------------------------------------------------------------
// <VendorFormModal> — add/edit popup for the /admin/vendors table
// ---------------------------------------------------------------------------
// Mirrors components/admin/customer-form-modal.tsx. One modal handles both
// flows:
//   - mode "add"  -> POST /admin/add_vendor_details    (new vendor + POCs)
//   - mode "edit" -> POST /admin/update_vendor_details (existing vendor,
//                    looked up by id)
// Neither endpoint exists yet — both are stubs to be wired up once the
// backend routes land (see backend/app/models/vendor_details.py and
// vendor_poc_details.py for the collections this maps onto).
//
// Unlike customers, vendors have no login (no email/password) — `id` (the
// VendorDetails Beanie primary key) is what identifies a vendor instead, so
// in edit mode it's carried in the payload but never shown as an editable
// field.
//
// `qrCode` is the vendor's standard UPI string (e.g. "upi://pay?pa=...").
// The admin uploads a photo/screenshot of the vendor's UPI QR code, which is
// sent to POST /admin/convert_vendor_qr to be decoded — see convertVendorQr
// in lib/vendors.ts. The decoded string is what actually gets submitted;
// there's no free-text editing of it since it's only ever meaningful as a
// verbatim decode of a real QR code.
//
// The delete/restore button reuses the same update_vendor_details call with
// every other field held as-is and just `is_deleted` flipped — a soft
// delete, not a real removal, so it also works as an "undelete".
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { convertVendorQr, type Vendor, type VendorPoc } from "@/lib/vendors";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function VendorFormModal({
  mode,
  initialVendor,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialVendor?: Vendor;
  onClose: () => void;
  onSaved: (vendor: Vendor) => void;
}) {
  const [registeredName, setRegisteredName] = useState(initialVendor?.registeredName ?? "");
  const [gst, setGst] = useState(initialVendor?.gst ?? "");
  const [address, setAddress] = useState(initialVendor?.address ?? "");
  const [description, setDescription] = useState(initialVendor?.description ?? "");
  const [pocs, setPocs] = useState<VendorPoc[]>(
    initialVendor?.pocs && initialVendor.pocs.length > 0 ? initialVendor.pocs : [{ name: "", phone: "" }],
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [qrCode, setQrCode] = useState(initialVendor?.qrCode ?? "");
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "converting">("idle");
  const [qrError, setQrError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const wasDeleted = initialVendor?.isDeleted ?? false;
  const title = isEdit ? "Edit vendor" : "Add new vendor";

  async function handleQrFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setQrPreviewUrl(URL.createObjectURL(file));
    setQrStatus("converting");
    setQrError(null);

    try {
      const decoded = await convertVendorQr(file);
      setQrCode(decoded);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : "Failed to read QR code");
      setQrCode("");
    } finally {
      setQrStatus("idle");
    }
  }

  function updatePoc(index: number, field: keyof VendorPoc, value: string) {
    setPocs((prev) => prev.map((poc, i) => (i === index ? { ...poc, [field]: value } : poc)));
  }

  function addPocRow() {
    setPocs((prev) => [...prev, { name: "", phone: "" }]);
  }

  function removePocRow(index: number) {
    setPocs((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Shared by the normal Save button and the delete/restore action below —
  // both just POST the current form state to update_vendor_details, only
  // differing in what `is_deleted` should end up as.
  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    const payload = {
      ...(isEdit ? { id: initialVendor?.id } : {}),
      registered_name: registeredName,
      gst,
      address,
      description,
      qr_code: qrCode,
      is_deleted: isDeletedValue,
      contact_name: pocs.map((p) => p.name),
      contact_phone: pocs.map((p) => p.phone),
    };

    try {
      const response = await apiFetch(isEdit ? "/admin/update_vendor_details" : "/admin/add_vendor_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError("A vendor with these details already exists.");
        } else if (response.status === 404) {
          setError("Vendor not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved({
        id: initialVendor?.id ?? 0,
        registeredName,
        gst,
        address,
        description,
        qrCode,
        isDeleted: isDeletedValue,
        pocs,
      });
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
        aria-labelledby="vendor-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="vendor-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
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
              <label htmlFor="gst" className={styles.formLabel}>
                GST number
              </label>
              <input
                id="gst"
                type="text"
                required
                value={gst}
                onChange={(e) => setGst(e.target.value.toUpperCase())}
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

            <div className={styles.formGridFullSpan}>
              <label htmlFor="description" className={styles.formLabel}>
                Description
              </label>
              <textarea
                id="description"
                required
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={styles.formTextarea}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="qrCodeUpload" className={styles.formLabel}>
                Vendor UPI QR code
              </label>
              <div className={styles.qrUploadRow}>
                {qrPreviewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote image
                  <img src={qrPreviewUrl} alt="Uploaded QR code" className={styles.qrPreview} />
                )}
                <div className={styles.qrUploadControls}>
                  <input
                    id="qrCodeUpload"
                    type="file"
                    accept="image/*"
                    onChange={handleQrFileChange}
                    className={styles.formInput}
                  />
                  {qrStatus === "converting" && <p className={styles.pageSubtext}>Reading QR code…</p>}
                  {qrError && (
                    <p role="alert" className={styles.formError}>
                      {qrError}
                    </p>
                  )}
                  {qrCode && qrStatus === "idle" && !qrError && (
                    <p className={styles.pageSubtext} title={qrCode}>
                      {qrCode}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.contactsSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Points of contact</span>
              <button type="button" onClick={addPocRow} className={styles.addContactButton}>
                + Add contact
              </button>
            </div>

            {pocs.map((poc, index) => (
              <div key={index} className={styles.contactRow}>
                <input
                  type="text"
                  placeholder="Contact name"
                  required
                  value={poc.name}
                  onChange={(e) => updatePoc(index, "name", e.target.value)}
                  className={styles.formInput}
                  aria-label={`Contact ${index + 1} name`}
                />
                <input
                  type="tel"
                  placeholder="Contact phone"
                  required
                  value={poc.phone}
                  onChange={(e) => updatePoc(index, "phone", e.target.value)}
                  className={styles.formInput}
                  aria-label={`Contact ${index + 1} phone`}
                />
                <button
                  type="button"
                  onClick={() => removePocRow(index)}
                  disabled={pocs.length === 1}
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
                  {wasDeleted ? "Restore vendor" : "Delete vendor"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this vendor?"
                      : "Are you sure you want to delete this vendor?"}
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
                <Button type="submit" variant="primary" disabled={status === "saving" || qrStatus === "converting"}>
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
