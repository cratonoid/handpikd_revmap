"use client";

// ---------------------------------------------------------------------------
// <CatalogueFormModal> — add/edit popup for the /admin/catalogues table
// ---------------------------------------------------------------------------
// Mirrors components/admin/product-form-modal.tsx. One modal handles both
// flows:
//   - mode "add"  -> POST /admin/add_catalogue_details    (new catalogue)
//   - mode "edit" -> POST /admin/update_catalogue_details (existing catalogue)
//
// Vendor and category are both single-selects (a catalogue has exactly one
// catalogue_vendor_id and one category_id) — see single-select-dropdown.tsx.
// `categoryOptions` is pre-filtered by the page client to top-level/root
// categories only (parent_id === null): a catalogue belongs to one main
// category, not a specific subcategory.
//
// Images: a catalogue's pages always come from converting an uploaded PDF
// (uploadCataloguePdf, see lib/catalogues.ts) rather than individual image
// uploads or pasted URLs — picking a PDF renders every page and appends the
// resulting page images (as "data:" URIs, not yet stored anywhere) to the
// grid below, where the admin can drop any pages that shouldn't be kept
// before saving. A page removed here that was already persisted (part of
// the catalogue's saved imagePaths when the form opened) is deleted from
// the backend right away, same as product images. Save itself is two-phase
// (see handleSubmit): the details call carries only already-persisted
// pages, then each new "data:" page is uploaded with its own
// addCatalogueImage call — bundling every page into one request routinely
// exceeded the server's request size limit on multi-page catalogues.
//
// Unlike products/vendors, catalogues have no soft-delete flag — the delete
// action here (edit mode only) is a real, permanent delete of the catalogue
// and all its page images, gated behind an inline confirm.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import {
  addCatalogueImage,
  deleteCatalogue,
  deleteCatalogueImage,
  uploadCataloguePdf,
  type Catalogue,
} from "@/lib/catalogues";
import type { VendorOption } from "@/lib/vendors";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const CATALOGUE_TYPE_OPTIONS = [
  { value: "brand", label: "Brand" },
  { value: "regular", label: "Regular" },
];

export function CatalogueFormModal({
  mode,
  initialCatalogue,
  vendors,
  categoryOptions,
  onClose,
  onImagesChangedWithoutSave,
  onSaved,
  onDeleted,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialCatalogue?: Catalogue;
  vendors: VendorOption[];
  categoryOptions: SingleSelectOption[];
  onClose: () => void;
  // Removing a page deletes it immediately (see removePage) rather than
  // waiting for Save, so closing the modal WITHOUT saving can still leave
  // the parent's catalogue list stale. Called instead of onClose when that
  // happened, so the parent can re-fetch get_catalogue_details rather than
  // trusting its own cached list.
  onImagesChangedWithoutSave: () => void;
  onSaved: (catalogue: Catalogue) => void;
  onDeleted: (catalogueId: number) => void;
}) {
  const [catalogueName, setCatalogueName] = useState(initialCatalogue?.catalogueName ?? "");
  const [vendorId, setVendorId] = useState<string | null>(
    initialCatalogue ? String(initialCatalogue.catalogueVendorId) : null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(initialCatalogue?.categoryId ?? null);
  const [catalogueType, setCatalogueType] = useState(initialCatalogue?.catalogueType ?? "");
  const [imagePaths, setImagePaths] = useState<string[]>(initialCatalogue?.imagePaths ?? []);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeletingCatalogue, setIsDeletingCatalogue] = useState(false);
  // Which page is mid-delete (disables its remove button) and any error from
  // that request — separate from the form's own error/status since removing
  // a page happens immediately, independent of the Save button.
  const [deletingPageIndex, setDeletingPageIndex] = useState<number | null>(null);
  const [pageDeleteError, setPageDeleteError] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [pdfUploadError, setPdfUploadError] = useState<string | null>(null);
  // Set once any page is actually deleted server-side this session — see
  // onImagesChangedWithoutSave above.
  const [hasUnsavedImageDeletion, setHasUnsavedImageDeletion] = useState(false);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit catalogue" : "Add new catalogue";

  // Closing (Cancel/X/backdrop) never runs onSaved, so if a page delete
  // already went to the server this session, the parent's cached catalogue
  // list needs a real re-fetch instead of just being told "closed".
  function handleClose() {
    if (hasUnsavedImageDeletion) {
      onImagesChangedWithoutSave();
    } else {
      onClose();
    }
  }

  // vendors comes from GET /admin/get_vendors_list, which only returns active
  // vendors — isDeleted is always false here (a since-deleted vendor on an
  // older catalogue just won't resolve to a label in the picker anymore).
  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
    isDeleted: false,
  }));

  // Renders every page of the chosen PDF into an image and appends the
  // results to the grid — the admin can drop any of them (including ones
  // from an earlier upload) before saving.
  async function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingPdf(true);
    setPdfUploadError(null);

    try {
      const newPaths = await uploadCataloguePdf(file);
      setImagePaths((prev) => [...prev, ...newPaths]);
    } catch (err) {
      setPdfUploadError(err instanceof Error ? err.message : "Couldn't convert PDF. Please try again.");
    } finally {
      setIsUploadingPdf(false);
    }
  }

  // If this page was already persisted (part of the catalogue's saved
  // imagePaths when the form opened), delete it from the backend right away
  // via delete_catalogue_image rather than waiting for a full form Save — a
  // page from this session's own PDF upload just comes out of local state,
  // since there's nothing to delete server-side yet.
  async function removePage(index: number) {
    const path = imagePaths[index];
    const wasPersisted = isEdit && initialCatalogue != null && initialCatalogue.imagePaths.includes(path);

    if (wasPersisted && initialCatalogue) {
      setDeletingPageIndex(index);
      setPageDeleteError(null);
      try {
        await deleteCatalogueImage(initialCatalogue.id, path);
      } catch {
        setPageDeleteError("Couldn't remove page. Please try again.");
        setDeletingPageIndex(null);
        return;
      }
      setDeletingPageIndex(null);
      setHasUnsavedImageDeletion(true);
    }

    setImagePaths((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }
    if (!categoryId) {
      setError("Please select a category.");
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    // Already-persisted pages go in the details save itself; pages from
    // this session's PDF upload (still "data:" URIs, never yet stored) are
    // saved one at a time afterward via addCatalogueImage — see the module
    // comment in routes/catalogues.py for why bundling every page into one
    // request doesn't scale.
    const persistedPaths = imagePaths.filter((path) => !path.startsWith("data:"));
    const pendingDataUris = imagePaths.filter((path) => path.startsWith("data:"));

    const detailsPayload = {
      ...(isEdit ? { id: initialCatalogue?.id } : {}),
      catalogue_name: catalogueName,
      catalogue_vendor_id: Number(vendorId),
      catalogue_type: catalogueType,
      category_id: Number(categoryId),
      image_paths: persistedPaths,
    };

    try {
      const detailsResponse = await apiFetch(
        isEdit ? "/admin/update_catalogue_details" : "/admin/add_catalogue_details",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detailsPayload),
        },
      );

      if (!detailsResponse.ok) {
        if (detailsResponse.status === 404) {
          setError("Vendor or category not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      const { id: catalogueId, image_paths: savedPersistedPaths }: { id: number; image_paths: string[] } =
        await detailsResponse.json();

      const uploadedPaths: string[] = [];
      try {
        for (const dataUri of pendingDataUris) {
          uploadedPaths.push(await addCatalogueImage(catalogueId, dataUri));
        }
      } catch {
        if (isEdit) {
          // The catalogue's other fields and kept pages are already saved
          // above — deleting the whole thing over one failed new page
          // would destroy real pre-existing data. Keep whatever uploaded
          // so far plus whichever pages never got attempted, still as
          // pending "data:" URIs, so the admin can just hit Save again.
          setImagePaths([...savedPersistedPaths, ...pendingDataUris.slice(uploadedPaths.length)]);
          setError(
            `Saved, but only ${uploadedPaths.length} of ${pendingDataUris.length} new page(s) uploaded. Try saving again for the rest.`,
          );
        } else {
          // Nothing about this catalogue was visible before this Save
          // attempt, so it's safe to fully roll it back rather than leave
          // a partial one behind — the admin can just retry.
          await deleteCatalogue(catalogueId).catch(() => {});
          setError("Couldn't save every page. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved({
        id: catalogueId,
        catalogueName,
        catalogueVendorId: Number(vendorId),
        catalogueType,
        categoryId,
        imagePaths: [...savedPersistedPaths, ...uploadedPaths],
      });
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  async function handleDelete() {
    if (!initialCatalogue) return;

    setIsDeletingCatalogue(true);
    try {
      await deleteCatalogue(initialCatalogue.id);
      onDeleted(initialCatalogue.id);
    } catch {
      setConfirmingDelete(false);
      setError("Couldn't delete this catalogue. Please try again.");
    } finally {
      setIsDeletingCatalogue(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalogue-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="catalogue-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="catalogueName" className={styles.formLabel}>
                Catalogue name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="catalogueName"
                type="text"
                required
                value={catalogueName}
                onChange={(e) => setCatalogueName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Vendor"
              placeholder="Select a vendor"
              required
              // vendorOptions is always active-only (see comment above), so
              // the Active/Deleted toggle would just be a permanently-empty
              // "Deleted" tab.
              showStatusFilter={false}
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={setVendorId}
            />

            <SingleSelectDropdown
              label="Category"
              placeholder="Select a category"
              entityLabel="categories"
              required
              showStatusFilter={false}
              options={categoryOptions}
              selectedValue={categoryId}
              onChange={setCategoryId}
            />

            <div>
              <label htmlFor="catalogueType" className={styles.formLabel}>
                Catalogue type<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="catalogueType"
                required
                value={catalogueType}
                onChange={(e) => setCatalogueType(e.target.value)}
                className={styles.formInput}
              >
                <option value="" disabled>
                  Select a type
                </option>
                {CATALOGUE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.imagesSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Catalogue pages</span>
              <label
                htmlFor="cataloguePdfUpload"
                className={`${styles.uploadPdfTrigger} ${isUploadingPdf ? styles.uploadPdfTriggerDisabled : ""}`}
              >
                {isUploadingPdf ? "Converting…" : "+ Upload PDF"}
              </label>
              <input
                id="cataloguePdfUpload"
                type="file"
                accept="application/pdf"
                onChange={(e) => void handlePdfFileChange(e)}
                disabled={isUploadingPdf}
                className="sr-only"
              />
            </div>

            {imagePaths.length === 0 && !isUploadingPdf && (
              <p className={styles.pageSubtext}>Upload a PDF to generate the catalogue pages.</p>
            )}

            <div className={styles.catalogueImageGrid}>
              {imagePaths.map((path, index) => (
                <div key={path} className={styles.catalogueImageCard}>
                  <div className={styles.catalogueImageThumbWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- backend-relative path, not an optimizable static asset */}
                    <img src={resolveMediaUrl(path)} alt={`Page ${index + 1}`} className={styles.imageThumb} />
                    <button
                      type="button"
                      onClick={() => void removePage(index)}
                      disabled={deletingPageIndex === index}
                      aria-label={`Remove page ${index + 1}`}
                      className={styles.catalogueImageRemoveButton}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className={styles.cataloguePageLabel}>Page {index + 1}</span>
                </div>
              ))}
            </div>

            {pageDeleteError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {pageDeleteError}
              </p>
            )}

            {pdfUploadError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {pdfUploadError}
              </p>
            )}
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
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete catalogue
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    Permanently delete this catalogue and all its pages?
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isDeletingCatalogue}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={() => void handleDelete()} disabled={isDeletingCatalogue}>
                    {isDeletingCatalogue ? "Deleting…" : "Yes, delete"}
                  </Button>
                </div>
              )}
            </div>

            {!confirmingDelete && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={handleClose}>
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
