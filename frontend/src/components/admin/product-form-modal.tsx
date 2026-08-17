"use client";

// ---------------------------------------------------------------------------
// <ProductFormModal> — add/edit popup for the /admin/products table
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendor-form-modal.tsx. One modal handles both
// flows:
//   - mode "add"  -> POST /admin/add_product_details    (new product)
//   - mode "edit" -> POST /admin/update_product_details (existing product,
//                    looked up by id)
// Neither endpoint exists yet — both are stubs to be wired up once the
// backend routes land (see backend/app/models/product_details.py).
//
// ProductDetails has no `is_deleted` field, only `is_visible` — so the
// delete/restore button here reuses that flag the same way vendors/customers
// reuse `is_deleted`: a soft toggle (not a real removal) that also works as
// an "undelete", with every other field held as-is.
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
import { addProductImage, deleteProductImage, uploadProductImage, type Product } from "@/lib/products";
import type { VendorOption } from "@/lib/vendors";
import type { CategoryNode } from "@/lib/categories";
import { CategoryTreeSelect } from "@/components/admin/category-tree-select";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { ArrowUpTrayIcon, CubeIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function ProductFormModal({
  mode,
  initialProduct,
  vendors,
  categoryTree,
  onClose,
  onImagesChangedWithoutSave,
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
  const [imagePaths, setImagePaths] = useState<string[]>(
    initialProduct?.imagePaths && initialProduct.imagePaths.length > 0 ? initialProduct.imagePaths : [""],
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
  const wasHidden = initialProduct ? !initialProduct.isVisible : false;
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

  // Shared by the normal Save button and the delete/restore action below —
  // both save the current form state, only differing in what `is_visible`
  // should end up as. Two-phase, same as catalogue-form-modal.tsx: details
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
          // ProductDetails has no hard delete, only this is_visible toggle
          // (same one delete/restore uses) — hide the incomplete product
          // rather than showing it to customers with missing images. Keep
          // whatever images did upload (keepPaths) rather than wiping them.
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

    void submitPayload(!wasHidden);
  }

  function handleDeleteOrRestore() {
    setConfirmingDelete(false);
    void submitPayload(wasHidden);
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
              {isEdit && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${wasHidden ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                >
                  {wasHidden ? "Restore product" : "Delete product"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasHidden
                      ? "Are you sure you want to restore this product?"
                      : "Are you sure you want to delete this product?"}
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
                    {status === "saving" ? "Saving…" : wasHidden ? "Yes, restore" : "Yes, delete"}
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
