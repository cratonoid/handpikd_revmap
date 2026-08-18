"use client";

// ---------------------------------------------------------------------------
// <ProductFormModal> — add/edit popup for the /admin/products table
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendor-form-modal.tsx. One modal handles both
// flows:
//   - mode "add"  -> POST /admin/add_product_details    (new product)
//   - mode "edit" -> POST /admin/update_product_details (existing product,
//                    looked up by id)
// Neither endpoint carries the delete flags: `is_visible` is an ordinary
// form field (the "Visible on the storefront" checkbox, on by default for a
// new product), while `is_deleted` is only ever moved by the dedicated
// delete/restore endpoints below.
//
// Deleting opens a second popup offering both kinds (see lib/products.ts):
//   - "Delete temporarily" -> soft delete. The product drops out of every
//     picker and the storefront but keeps its row and images, so older
//     orders/quotations/invoices still show its name, and it can be restored
//     from the Deleted tab on /admin/products.
//   - "Delete permanently"  -> the row, its image rows and the image files
//     are gone for good, so it takes a second confirmation, and the backend
//     refuses with a 409 (surfaced here verbatim, e.g. "used by 2 sales
//     orders") if any document still references the product.
// Either way the delete acts on the SAVED product, discarding whatever is
// unsaved in the form — it doesn't save-then-flag the way the old
// is_visible-based delete did.
//
// Vendor is a single-select (a product has exactly one vendor_id) and
// categories are a multiselect (category_ids is an array on ProductDetails) —
// see single-select-dropdown.tsx / category-tree-select.tsx. The category
// picker is a drill-down tree (unfolds one level per click, same idea as the
// hamper inquiry form) rather than a flat searchable list.
//
// Images: each row is either uploaded (handleImageFileChange -> local disk
// via uploadProductImage, see lib/products.ts) or a manually pasted URL —
// either way `imagePaths` is a growing list of path/URL strings, each
// expected to become an `image_path` row in product_image_details once the
// form is saved. Uploaded paths come back backend-relative (e.g.
// "/media/<uuid>.jpg"); resolveMediaUrl (lib/api.ts) is what makes those
// resolve to an actual image both locally and in production.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { GST_PERCENT_OPTIONS } from "@/lib/gst";
import {
  addProductImage,
  deleteProduct,
  deleteProductImage,
  restoreProduct,
  uploadProductImage,
  type Product,
} from "@/lib/products";
import type { VendorOption } from "@/lib/vendors";
import type { CategoryNode } from "@/lib/categories";
import { CategoryTreeSelect } from "@/components/admin/category-tree-select";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { ArrowUpTrayIcon, CubeIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving" | "deleting";

// Which screen of the delete popup is open: "choice" is the temporary-vs-
// permanent pick, "permanent" the extra are-you-sure only the irreversible
// one gets. null = popup closed.
type DeleteStep = "choice" | "permanent" | null;

export function ProductFormModal({
  mode,
  initialProduct,
  vendors,
  categoryTree,
  onClose,
  onImagesChangedWithoutSave,
  onPermanentlyDeleted,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialProduct?: Product;
  vendors: VendorOption[];
  categoryTree: CategoryNode[];
  onClose: () => void;
  // Image removal deletes immediately (see removeImageRow) rather than
  // waiting for Save, so closing the modal WITHOUT saving can still leave
  // the parent's product list stale — its imagePaths (and, via
  // initialProduct, any later re-open of this same product) would still
  // include an image that's actually already gone server-side. Called
  // instead of onClose when that happened, so the parent can re-fetch
  // get_product_details rather than trusting its own cached list.
  onImagesChangedWithoutSave: () => void;
  onSaved: (product: Product) => void;
  // Permanent delete only — the product is gone, so the parent drops it from
  // its list outright instead of updating a row (soft delete and restore
  // both come back through onSaved with isDeleted flipped).
  onPermanentlyDeleted: (productId: number) => void;
}) {
  const [productName, setProductName] = useState(initialProduct?.productName ?? "");
  const [hsnCode, setHsnCode] = useState(initialProduct?.hsnCode ?? "");
  const [vendorId, setVendorId] = useState<string | null>(
    initialProduct ? String(initialProduct.vendorId) : null,
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(initialProduct?.categoryIds ?? []);
  const [vendorRate, setVendorRate] = useState(initialProduct ? String(initialProduct.vendorRate) : "");
  const [actualPrice, setActualPrice] = useState(initialProduct ? String(initialProduct.actualPrice) : "");
  const [discountedPrice, setDiscountedPrice] = useState(
    initialProduct ? String(initialProduct.discountedPrice) : "",
  );
  const [gstPerc, setGstPerc] = useState(initialProduct ? String(initialProduct.gstPerc) : "");
  const [moq, setMoq] = useState(initialProduct?.moq ?? 1);
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  // On by default for a new product — a product is meant to be on the
  // storefront unless the admin says otherwise.
  const [isVisible, setIsVisible] = useState(initialProduct?.isVisible ?? true);
  const [imagePaths, setImagePaths] = useState<string[]>(
    initialProduct?.imagePaths && initialProduct.imagePaths.length > 0 ? initialProduct.imagePaths : [""],
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>(null);
  // Kept apart from the form's own `error` because it's shown inside the
  // delete popup, and because a permanent delete's 409 carries a message
  // worth showing as-is ("used by 2 sales orders, 1 quotation").
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Which image row is mid-delete (disables its button) and any error from
  // that request — separate from the form's own error/status since deleting
  // an image happens immediately, independent of the Save button.
  const [deletingImageIndex, setDeletingImageIndex] = useState<number | null>(null);
  const [imageDeleteError, setImageDeleteError] = useState<string | null>(null);
  // Which image row is mid-upload (disables its inputs) and any error from
  // that upload — separate from the form's own error/status the same way
  // deletingImageIndex/imageDeleteError are, since an upload also happens
  // immediately rather than waiting for Save.
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  // Set once any image is actually deleted server-side this session — see
  // onImagesChangedWithoutSave above.
  const [hasUnsavedImageDeletion, setHasUnsavedImageDeletion] = useState(false);

  const isEdit = mode === "edit";
  const isDeleted = initialProduct?.isDeleted ?? false;
  const busy = status !== "idle";
  const title = isEdit ? "Edit product" : "Add new product";

  // Closing (Cancel/X/backdrop) never runs onSaved, so if an image delete
  // already went to the server this session, the parent's cached product
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
  // older product just won't resolve to a label in the picker anymore).
  // Further filtered to GST-registered vendors only: a product's vendor
  // needs to be GST-invoiceable, whereas gst itself is optional on
  // VendorDetails (see vendor-form-modal.tsx) so a vendor can still be added
  // without one. Same "won't resolve to a label anymore" caveat applies to
  // an older product whose vendor has since had its GST number cleared.
  const vendorOptions: SingleSelectOption[] = vendors
    .filter((vendor) => vendor.gst !== "")
    .map((vendor) => ({
      value: String(vendor.id),
      label: vendor.name,
      isDeleted: false,
    }));

  function updateImagePath(index: number, value: string) {
    setImagePaths((prev) => prev.map((path, i) => (i === index ? value : path)));
  }

  function addImageRow() {
    setImagePaths((prev) => [...prev, ""]);
  }

  // Uploads the chosen file to the backend (see lib/products.ts) and, on
  // success, fills this row's URL with the returned /media link — replacing
  // whatever was there before (a blank new row, or an existing pasted/uploaded URL).
  async function handleImageFileChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingImageIndex(index);
    setImageUploadError(null);

    try {
      const url = await uploadProductImage(file);
      updateImagePath(index, url);
    } catch {
      setImageUploadError("Couldn't upload image. Please try again.");
    } finally {
      setUploadingImageIndex(null);
    }
  }

  // If this row's path was already persisted (part of the product's saved
  // imagePaths when the form opened), delete it from the backend right away
  // via delete_product_image rather than waiting for a full form Save — a
  // brand-new, not-yet-saved row just comes out of local state, since
  // there's nothing to delete server-side yet.
  async function removeImageRow(index: number) {
    const path = imagePaths[index].trim();
    const wasPersisted = isEdit && initialProduct != null && initialProduct.imagePaths.includes(path);

    if (wasPersisted && initialProduct) {
      setDeletingImageIndex(index);
      setImageDeleteError(null);
      try {
        await deleteProductImage(initialProduct.id, path);
      } catch {
        setImageDeleteError("Couldn't delete image. Please try again.");
        setDeletingImageIndex(null);
        return;
      }
      setDeletingImageIndex(null);
      setHasUnsavedImageDeletion(true);
    }

    setImagePaths((prev) => prev.filter((_, i) => i !== index));
  }

  function buildDetailsPayload(id: number | undefined, isVisibleValue: boolean, keepPaths: string[]) {
    return {
      ...(id !== undefined ? { id } : {}),
      product_name: productName,
      hsn_code: hsnCode,
      vendor_id: vendorId !== null ? Number(vendorId) : null,
      vendor_rate: Number(vendorRate) || 0,
      actual_price: Number(actualPrice) || 0,
      discounted_price: Number(discountedPrice) || 0,
      gst_perc: Number(gstPerc) || 0,
      category_ids: categoryIds.map(Number),
      moq,
      description,
      is_visible: isVisibleValue,
      image_paths: keepPaths,
    };
  }

  // Used by the normal Save button, and by the fallback below that re-saves
  // a new product hidden when its images didn't all upload — hence
  // `is_visible` being a parameter rather than just the checkbox's value.
  // Two-phase, same as catalogue-form-modal.tsx: details
  // first (carrying only already-persisted paths/pasted URLs), then one
  // addProductImage call per pending "data:" image, since bundling every
  // image's bytes into one request risked the same request-size blowup
  // fixed for catalogues (see routes/catalogues.py's module docstring).
  async function submitPayload(isVisibleValue: boolean) {
    setStatus("saving");
    setError(null);

    const cleanedPaths = imagePaths.map((path) => path.trim()).filter(Boolean);
    const persistedPaths = cleanedPaths.filter((path) => !path.startsWith("data:"));
    const pendingDataUris = cleanedPaths.filter((path) => path.startsWith("data:"));

    try {
      const detailsResponse = await apiFetch(isEdit ? "/admin/update_product_details" : "/admin/add_product_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDetailsPayload(isEdit ? initialProduct?.id : undefined, isVisibleValue, persistedPaths)),
      });

      if (!detailsResponse.ok) {
        if (detailsResponse.status === 409) {
          setError("A product with these details already exists.");
        } else if (detailsResponse.status === 404) {
          setError("Product not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      const { id: productId, image_paths: savedPersistedPaths }: { id: number; image_paths: string[] } =
        await detailsResponse.json();

      const uploadedPaths: string[] = [];
      try {
        for (const dataUri of pendingDataUris) {
          uploadedPaths.push(await addProductImage(productId, dataUri));
        }
      } catch {
        const keepPaths = [...savedPersistedPaths, ...uploadedPaths];
        if (!isEdit) {
          // Hide the incomplete product rather than showing it to customers
          // with missing images — is_visible, not is_deleted, because this
          // is a half-finished save the admin is expected to come back and
          // finish, not something they asked to delete. Keep whatever images
          // did upload (keepPaths) rather than wiping them.
          await apiFetch("/admin/update_product_details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildDetailsPayload(productId, false, keepPaths)),
          }).catch(() => {});
        }
        setImagePaths([...keepPaths, ...pendingDataUris.slice(uploadedPaths.length)]);
        setError(
          isEdit
            ? `Saved, but only ${uploadedPaths.length} of ${pendingDataUris.length} new image(s) uploaded. Try saving again for the rest.`
            : "Couldn't upload every image, so this product was saved hidden. Try saving again to finish and make it visible.",
        );
        setStatus("idle");
        return;
      }

      onSaved({
        id: productId,
        productName,
        hsnCode,
        vendorId: vendorId !== null ? Number(vendorId) : 0,
        vendorRate: Number(vendorRate) || 0,
        actualPrice: Number(actualPrice) || 0,
        discountedPrice: Number(discountedPrice) || 0,
        gstPerc: Number(gstPerc) || 0,
        categoryIds,
        moq,
        description,
        isVisible: isVisibleValue,
        // Saving never moves is_deleted — only the delete/restore endpoints
        // do, and neither goes through here.
        isDeleted,
        imagePaths: [...savedPersistedPaths, ...uploadedPaths],
      });
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (Number(vendorRate) <= 0) {
      setError("Vendor rate must be greater than 0.");
      return;
    }

    if (Number(actualPrice) <= 0) {
      setError("Actual price must be greater than 0.");
      return;
    }

    if (Number(discountedPrice) <= 0) {
      setError("Discounted price must be greater than 0.");
      return;
    }

    if (Number(discountedPrice) >= Number(actualPrice)) {
      setError("Discounted price must be less than the actual price.");
      return;
    }

    void submitPayload(isVisible);
  }

  // Acts on the saved product, not the form — any unsaved edits are dropped,
  // which is the point: the admin asked for this product to go, not for
  // their half-finished changes to be written first.
  async function handleDelete(permanent: boolean) {
    if (!initialProduct) return;

    setStatus("deleting");
    setDeleteError(null);
    try {
      await deleteProduct(initialProduct.id, permanent);
    } catch (error) {
      // The backend's 409 detail is the useful part on a permanent delete
      // (it names what still references the product), so show it verbatim
      // rather than a generic failure line.
      setDeleteError(error instanceof Error ? error.message : "Couldn't delete this product. Please try again.");
      setStatus("idle");
      return;
    }

    setStatus("idle");
    setDeleteStep(null);
    if (permanent) {
      onPermanentlyDeleted(initialProduct.id);
    } else if (hasUnsavedImageDeletion) {
      // initialProduct's imagePaths still list an image this session already
      // deleted server-side, so spreading it would put a stale row in the
      // Deleted tab — a re-fetch picks up both the missing image and the
      // is_deleted that was just set.
      onImagesChangedWithoutSave();
    } else {
      onSaved({ ...initialProduct, isDeleted: true });
    }
  }

  async function handleRestore() {
    if (!initialProduct) return;

    setStatus("deleting");
    setDeleteError(null);
    try {
      await restoreProduct(initialProduct.id);
    } catch (error) {
      // 409 here means another product has taken this one's HSN code + name
      // pair while it was deleted — again worth showing as-is.
      setError(error instanceof Error ? error.message : "Couldn't restore this product. Please try again.");
      setStatus("idle");
      return;
    }

    setStatus("idle");
    if (hasUnsavedImageDeletion) {
      // Same stale-imagePaths case as handleDelete's soft branch.
      onImagesChangedWithoutSave();
    } else {
      onSaved({ ...initialProduct, isDeleted: false });
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="product-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="productName" className={styles.formLabel}>
                Product name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="productName"
                type="text"
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="hsnCode" className={styles.formLabel}>
                HSN code<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="hsnCode"
                type="text"
                required
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="moq" className={styles.formLabel}>
                MOQ (minimum order qty)<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="moq"
                type="number"
                min={1}
                required
                value={moq}
                onChange={(e) => setMoq(Number(e.target.value))}
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

            <CategoryTreeSelect
              label="Categories"
              placeholder="Select categories"
              tree={categoryTree}
              selectedValues={categoryIds}
              onChange={setCategoryIds}
            />

            <div>
              <label htmlFor="vendorRate" className={styles.formLabel}>
                Vendor rate<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="vendorRate"
                type="text"
                inputMode="decimal"
                required
                value={vendorRate}
                onChange={(e) => setVendorRate(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="gstPerc" className={styles.formLabel}>
                GST %<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="gstPerc"
                required
                value={gstPerc}
                onChange={(e) => setGstPerc(e.target.value)}
                className={styles.formInput}
              >
                <option value="" disabled>
                  Select GST %
                </option>
                {/* Hardcoded placeholder slabs — see lib/gst.ts */}
                {GST_PERCENT_OPTIONS.map((percent) => (
                  <option key={percent} value={percent}>
                    {percent}%
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="actualPrice" className={styles.formLabel}>
                Actual price<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="actualPrice"
                type="text"
                inputMode="decimal"
                required
                value={actualPrice}
                onChange={(e) => setActualPrice(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="discountedPrice" className={styles.formLabel}>
                Discounted price<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="discountedPrice"
                type="text"
                inputMode="decimal"
                required
                value={discountedPrice}
                onChange={(e) => setDiscountedPrice(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="description" className={styles.formLabel}>
                Description<span className={styles.requiredMark}>*</span>
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

            {/* Storefront visibility only — an unticked product still shows
                up in the order/quotation/invoice pickers, it just isn't
                offered to customers. That's what separates it from a delete,
                hence the hint text. */}
            <div className={styles.formGridFullSpan}>
              <label htmlFor="isVisible" className={styles.formCheckboxField}>
                <input
                  id="isVisible"
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                  className={styles.selectCheckbox}
                />
                <span className={styles.formCheckboxText}>
                  <span className={styles.formCheckboxLabel}>Visible</span>
                  <span className={styles.formCheckboxHint}>
                    Shown on the storefront and in the customer inquiry cart. Unticking moves it to Hidden products; it
                    can still be quoted, ordered and invoiced.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className={styles.imagesSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Product images</span>
              <button type="button" onClick={addImageRow} className={styles.addContactButton}>
                + Add image
              </button>
            </div>

            {imagePaths.map((path, index) => {
              const isUploading = uploadingImageIndex === index;
              return (
                <div key={index} className={styles.imageRow}>
                  {path.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset
                    <img
                      src={resolveMediaUrl(path.trim())}
                      alt=""
                      className={styles.imageThumb}
                      onError={(e) => {
                        e.currentTarget.style.opacity = "0";
                      }}
                    />
                  ) : (
                    <div className={styles.imageThumbEmpty}>
                      <CubeIcon className="h-8 w-8" />
                    </div>
                  )}
                  <input
                    type="url"
                    placeholder="Upload a file, or paste an image URL"
                    value={path}
                    onChange={(e) => updateImagePath(index, e.target.value)}
                    disabled={isUploading}
                    className={styles.formInput}
                    aria-label={`Image ${index + 1} URL`}
                  />
                  <label
                    htmlFor={`imageUpload-${index}`}
                    className={`${styles.uploadImageButton} ${isUploading ? styles.uploadImageButtonDisabled : ""}`}
                    aria-label={`Upload image ${index + 1}`}
                  >
                    <ArrowUpTrayIcon className="h-4 w-4" />
                  </label>
                  <input
                    id={`imageUpload-${index}`}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handleImageFileChange(index, e)}
                    disabled={isUploading}
                    className="sr-only"
                  />
                  <button
                    type="button"
                    onClick={() => void removeImageRow(index)}
                    disabled={deletingImageIndex === index || isUploading}
                    aria-label={`Remove image ${index + 1}`}
                    className={styles.removeContactButton}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                  {isUploading && <p className={styles.pageSubtext}>Uploading…</p>}
                </div>
              );
            })}

            {imageDeleteError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {imageDeleteError}
              </p>
            )}

            {imageUploadError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {imageUploadError}
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
              {isEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    if (isDeleted) {
                      void handleRestore();
                    } else {
                      setDeleteStep("choice");
                    }
                  }}
                  disabled={busy}
                  className={`${styles.triggerButtonBase} ${isDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {isDeleted
                    ? status === "deleting"
                      ? "Restoring…"
                      : "Restore product"
                    : "Delete product"}
                </button>
              )}
            </div>

            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {status === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Delete popup, layered over the form (its own backdrop, so the form
          stays visible but unreachable behind it). Two screens: pick which
          kind of delete, then — for the permanent one only — confirm, since
          that one can't be undone. */}
      {deleteStep !== null && (
        <div
          className={styles.modalBackdrop}
          onClick={(event) => {
            event.stopPropagation();
            if (!busy) setDeleteStep(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-delete-title"
            className={styles.confirmDialogPanel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="product-delete-title" className={styles.modalTitle}>
                {deleteStep === "choice" ? "Delete product" : "Delete permanently?"}
              </h2>
              <button
                type="button"
                onClick={() => setDeleteStep(null)}
                disabled={busy}
                aria-label="Close"
                className={styles.modalCloseButton}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className={styles.confirmDialogBody}>
              {deleteStep === "choice" ? (
                <>
                  <p className={styles.confirmDialogIntro}>
                    How should “{initialProduct?.productName}” be deleted?
                  </p>

                  <div className={styles.confirmDialogOptions}>
                    <button
                      type="button"
                      onClick={() => void handleDelete(false)}
                      disabled={busy}
                      className={styles.confirmOptionButton}
                    >
                      <span className={styles.confirmOptionTitle}>Delete temporarily</span>
                      <span className={styles.confirmOptionText}>
                        Moves it to the Deleted tab. It disappears from the storefront and from every order, quotation
                        and invoice picker, but its images and its name on past documents are kept — and it can be
                        restored later.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteStep("permanent");
                      }}
                      disabled={busy}
                      className={`${styles.confirmOptionButton} ${styles.confirmOptionButtonDanger}`}
                    >
                      <span className={styles.confirmOptionTitle}>Delete permanently</span>
                      <span className={styles.confirmOptionText}>
                        Erases the product and its uploaded images from the server for good. Not possible if any order,
                        quotation, proforma invoice or purchase order still lists it.
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <p className={styles.confirmDialogIntro}>
                  “{initialProduct?.productName}” and all of its uploaded images will be erased from the server. This
                  can’t be undone.
                </p>
              )}

              {deleteError && (
                <p role="alert" aria-live="polite" className={styles.formError}>
                  {deleteError}
                </p>
              )}
            </div>

            <div className={styles.confirmDialogActions}>
              <Button
                type="button"
                variant="tertiary"
                onClick={() => (deleteStep === "permanent" ? setDeleteStep("choice") : setDeleteStep(null))}
                disabled={busy}
              >
                {deleteStep === "permanent" ? "Back" : "Cancel"}
              </Button>
              {deleteStep === "permanent" && (
                <button
                  type="button"
                  onClick={() => void handleDelete(true)}
                  disabled={busy}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  {status === "deleting" ? "Deleting…" : "Yes, delete permanently"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
