"use client";

// ---------------------------------------------------------------------------
// <PriceListFormModal> — add/edit popup for the /admin/price-lists table
// ---------------------------------------------------------------------------
// Mirrors catalogue-form-modal.tsx, minus the page conversion: a price list
// keeps the vendor's file (a PDF or an Excel workbook) exactly as uploaded,
// so picking a file just holds
// it until Save, which sends the fields and the file together (see
// savePriceList in lib/price-lists.ts).
//   - mode "add"  -> POST /admin/add_price_list    (file required)
//   - mode "edit" -> POST /admin/update_price_list (file only if replacing)
//
// The catalogue link is optional. Its picker lists the selected vendor's own
// catalogues first, then every other one — a distributor's price list can
// legitimately price a brand catalogue filed under a different vendor, so
// the others stay pickable rather than being filtered out.
//
// Delete (edit mode only) is permanent — the record and its file both go —
// and sits behind an inline confirm, like the catalogue delete.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import {
  deletePriceList,
  PRICE_LIST_FILE_ACCEPT,
  savePriceList,
  type PriceList,
  type PriceListCatalogueOption,
} from "@/lib/price-lists";
import type { VendorOption } from "@/lib/vendors";
import styles from "@/styles/dashboard.module.css";

export function PriceListFormModal({
  mode,
  initialPriceList,
  vendors,
  catalogues,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialPriceList?: PriceList;
  vendors: VendorOption[];
  catalogues: PriceListCatalogueOption[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [priceListName, setPriceListName] = useState(initialPriceList?.priceListName ?? "");
  const [vendorId, setVendorId] = useState<string | null>(
    initialPriceList ? String(initialPriceList.vendorId) : null,
  );
  const [catalogueId, setCatalogueId] = useState<string>(
    initialPriceList?.catalogueId != null ? String(initialPriceList.catalogueId) : "",
  );
  const [notes, setNotes] = useState(initialPriceList?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit price list" : "Add price list";

  // get_vendors_list is active-only, so there's no "Deleted" group to show.
  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
    isDeleted: false,
  }));

  const vendorCatalogues = catalogues.filter((c) => vendorId !== null && String(c.vendorId) === vendorId);
  const otherCatalogues = catalogues.filter((c) => vendorId === null || String(c.vendorId) !== vendorId);
  const vendorNamesById = new Map(vendors.map((v) => [v.id, v.name]));

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!picked) return;
    setFile(picked);
    setError(null);
    // Most vendor files are already named for what they are, so an empty
    // name field takes the file's name as a starting point.
    if (priceListName.trim() === "") {
      setPriceListName(picked.name.replace(/\.(pdf|xlsx|xls)$/i, ""));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }
    if (!isEdit && !file) {
      setError("Please choose the price list file.");
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await savePriceList({
        id: isEdit ? initialPriceList?.id : undefined,
        priceListName,
        vendorId: Number(vendorId),
        catalogueId: catalogueId === "" ? null : Number(catalogueId),
        notes,
        file,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the server. Please try again.");
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!initialPriceList) return;

    setIsDeleting(true);
    try {
      await deletePriceList(initialPriceList.id);
      onDeleted();
    } catch {
      setConfirmingDelete(false);
      setError("Couldn't delete this price list. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  const currentFileLabel = file
    ? file.name
    : isEdit
      ? initialPriceList?.originalFilename || "Current file"
      : "PDF or Excel (.xlsx / .xls)";

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-list-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="price-list-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <div className={styles.contactsHeader}>
                <span className={styles.formLabel}>
                  Price list file{!isEdit && <span className={styles.requiredMark}>*</span>}
                </span>
                <label htmlFor="priceListPdfUpload" className={styles.uploadPdfTrigger}>
                  {isEdit || file ? "Replace file" : "+ Choose file"}
                </label>
                <input
                  id="priceListPdfUpload"
                  type="file"
                  accept={PRICE_LIST_FILE_ACCEPT}
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </div>
              <p className={styles.pageSubtext}>
                {currentFileLabel}
                {isEdit && file && " — replaces the current file on save"}
              </p>
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="priceListName" className={styles.formLabel}>
                Price list name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="priceListName"
                type="text"
                required
                value={priceListName}
                onChange={(e) => setPriceListName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Vendor"
              placeholder="Select a vendor"
              required
              showStatusFilter={false}
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={setVendorId}
            />

            <div>
              <label htmlFor="priceListCatalogue" className={styles.formLabel}>
                Linked catalogue
              </label>
              <select
                id="priceListCatalogue"
                value={catalogueId}
                onChange={(e) => setCatalogueId(e.target.value)}
                className={styles.formInput}
              >
                <option value="">No catalogue</option>
                {vendorCatalogues.length > 0 && (
                  <optgroup label="This vendor's catalogues">
                    {vendorCatalogues.map((catalogue) => (
                      <option key={catalogue.id} value={catalogue.id}>
                        {catalogue.catalogueName}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherCatalogues.length > 0 && (
                  <optgroup label={vendorId ? "Other catalogues" : "Catalogues"}>
                    {otherCatalogues.map((catalogue) => {
                      const vendorName = vendorNamesById.get(catalogue.vendorId);
                      return (
                        <option key={catalogue.id} value={catalogue.id}>
                          {vendorName ? `${catalogue.catalogueName} (${vendorName})` : catalogue.catalogueName}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </select>
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="priceListNotes" className={styles.formLabel}>
                Notes
              </label>
              <textarea
                id="priceListNotes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={styles.formTextarea}
              />
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
                  disabled={isSaving}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete price list
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>Permanently delete this price list and its file?</span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={() => void handleDelete()} disabled={isDeleting}>
                    {isDeleting ? "Deleting…" : "Yes, delete"}
                  </Button>
                </div>
              )}
            </div>

            {!confirmingDelete && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
