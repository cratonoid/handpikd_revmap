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
// see single-select-dropdown.tsx / multi-select-dropdown.tsx.
//
// Images: there's no uploader yet, so `imagePaths` is just a growing list of
// pasted URLs (e.g. from an existing online source), each expected to become
// an `image_path` row in product_image_details once the backend catches up.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import type { Product } from "@/lib/products";
import type { VendorOption } from "@/lib/vendors";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { CubeIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

export function ProductFormModal({
  mode,
  initialProduct,
  vendors,
  categoryOptions,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialProduct?: Product;
  vendors: VendorOption[];
  categoryOptions: MultiSelectOption[];
  onClose: () => void;
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

  const isEdit = mode === "edit";
  const wasHidden = initialProduct ? !initialProduct.isVisible : false;
  const title = isEdit ? "Edit product" : "Add new product";

  // vendors comes from GET /admin/get_vendors_list, which only returns active
  // vendors — isDeleted is always false here (a since-deleted vendor on an
  // older product just won't resolve to a label in the picker anymore).
  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
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

  function removeImageRow(index: number) {
    setImagePaths((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Shared by the normal Save button and the delete/restore action below —
  // both just POST the current form state to update_product_details, only
  // differing in what `is_visible` should end up as.
  async function submitPayload(isVisibleValue: boolean) {
    setStatus("saving");
    setError(null);

    const payload = {
      ...(isEdit ? { id: initialProduct?.id } : {}),
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
      image_paths: imagePaths.map((path) => path.trim()).filter(Boolean),
    };

    try {
      const response = await apiFetch(isEdit ? "/admin/update_product_details" : "/admin/add_product_details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError("A product with these details already exists.");
        } else if (response.status === 404) {
          setError("Product not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved({
        id: initialProduct?.id ?? 0,
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
        imagePaths: imagePaths.map((path) => path.trim()).filter(Boolean),
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

    void submitPayload(!wasHidden);
  }

  function handleDeleteOrRestore() {
    setConfirmingDelete(false);
    void submitPayload(wasHidden);
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
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
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="productName" className={styles.formLabel}>
                Product name
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
                HSN code
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
                MOQ (minimum order qty)
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
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={setVendorId}
            />

            <MultiSelectDropdown
              label="Categories"
              placeholder="Select categories"
              options={categoryOptions}
              selectedValues={categoryIds}
              onChange={setCategoryIds}
            />

            <div>
              <label htmlFor="vendorRate" className={styles.formLabel}>
                Vendor rate
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
                GST %
              </label>
              <input
                id="gstPerc"
                type="text"
                inputMode="decimal"
                required
                value={gstPerc}
                onChange={(e) => setGstPerc(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="actualPrice" className={styles.formLabel}>
                Actual price
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
                Discounted price
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
          </div>

          <div className={styles.imagesSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Product images (image URLs — uploader coming later)</span>
              <button type="button" onClick={addImageRow} className={styles.addContactButton}>
                + Add image
              </button>
            </div>

            {imagePaths.map((path, index) => (
              <div key={index} className={styles.imageRow}>
                {path.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL, not an optimizable local/remote asset
                  <img
                    src={path.trim()}
                    alt=""
                    className={styles.imageThumb}
                    onError={(e) => {
                      e.currentTarget.style.opacity = "0";
                    }}
                  />
                ) : (
                  <div className={styles.imageThumbEmpty}>
                    <CubeIcon className="h-4 w-4" />
                  </div>
                )}
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={path}
                  onChange={(e) => updateImagePath(index, e.target.value)}
                  className={styles.formInput}
                  aria-label={`Image ${index + 1} URL`}
                />
                <button
                  type="button"
                  onClick={() => removeImageRow(index)}
                  disabled={imagePaths.length === 1}
                  aria-label={`Remove image ${index + 1}`}
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
                <Button type="button" variant="tertiary" onClick={onClose}>
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
