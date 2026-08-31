"use client";

// ---------------------------------------------------------------------------
// <QuotationFormModal> — add/edit popup on the Quotation tab of /admin/quotation
// ---------------------------------------------------------------------------
// Line-item structure follows sales-order-form-modal.tsx (a product picker
// auto-fills rate/tax % from the product but both stay editable, "+ Add line
// item" / per-row remove). Two dates instead of one:
//   - date       -> issue date, defaults to "now"
//   - validTill  -> defaults to issue date + 10 days (addDaysToDateValue)
// Both stay freely editable afterward, same as every other date field here.
// Date-only (no time-of-day) — unlike the order/invoice forms' datetime-local
// fields, quotations only ever need the calendar date.
//
// Where this diverges from every other form here: a quotation can be raised
// against things that don't exist in the system yet, since it's often the
// first document in a deal.
//   - The buyer is either an existing client (custId) or a one-off name +
//     address typed straight in (customerName/customerAddress).
//   - Each line is either a catalogue product (productId) or a one-off name
//     + optional image typed straight in (productName/imagePath).
// Neither is written back to #customer_details/#product_details — quoting a
// prospect for something not in the catalogue shouldn't leave junk rows
// behind — so both are stored on the quotation itself and render from there.
// Exactly one side of each pair is ever submitted; see lib/quotations.ts and
// backend/app/schemas/quotations.py, which enforces the same rule.
//
//   - mode "add"  -> POST /admin/create_new_quotation, then immediately
//                    downloads the generated PDF (createQuotation returns the
//                    new id/quotationNo precisely so this can chain straight
//                    into downloadQuotationPdf without a re-fetch) — this is
//                    the "fill the form, hit Generate, get a PDF" flow.
//   - mode "edit" -> POST /admin/update_quotation_details; also exposes the
//                    status dropdown (Draft/Sent/Accepted/Rejected/Expired),
//                    which — like order_status_id on sales orders — only
//                    ever appears/submits in edit mode; new quotations are
//                    silently created as "draft" on the backend.
// Both live in backend/app/api/routes/quotations.py.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { resolveMediaUrl } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { addDaysToDateValue, nowAsDateValue, toDateValue } from "@/lib/datetime-input";
import type { Quotation, QuotationStatus } from "@/lib/quotations";
import { createQuotation, downloadQuotationPdf, updateQuotation } from "@/lib/quotations";
import type { CustomerOption } from "@/lib/customers";
import { uploadProductImage, type Product } from "@/lib/products";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { ArrowUpTrayIcon, CubeIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

// Which side of the either/or the buyer and each line item are currently on.
type CustomerMode = "existing" | "custom";
type LineItemMode = "catalogue" | "custom";

const VALID_TILL_DAYS = 10;

const STATUS_OPTIONS: SingleSelectOption[] = [
  { value: "draft", label: "Draft", isDeleted: false },
  { value: "sent", label: "Sent", isDeleted: false },
  { value: "accepted", label: "Accepted", isDeleted: false },
  { value: "rejected", label: "Rejected", isDeleted: false },
  { value: "expired", label: "Expired", isDeleted: false },
];

type LineItem = {
  mode: LineItemMode;
  // productId is set on a "catalogue" line; productName/imagePath on a
  // "custom" one. The unused side is kept rather than cleared as you toggle,
  // so flipping to one-off to key in a price and back doesn't lose the
  // product already picked.
  productId: string | null;
  productName: string;
  imagePath: string;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput — same reasoning as
  // sales-order-form-modal.tsx's LineItem.rate.
  rate: string;
  taxPerc: string;
};

function emptyLineItem(): LineItem {
  return {
    mode: "catalogue",
    productId: null,
    productName: "",
    imagePath: "",
    quantity: 1,
    rate: "",
    taxPerc: "",
  };
}

// Reassembles an existing quotation's parallel productIds/productNames/
// imagePaths/quantities/rates/taxPercs arrays (see lib/quotations.ts) back
// into per-line-item rows. A null productId is what marks a saved line as
// one-off, mirroring how the backend stores it.
function lineItemsFromQuotation(quotation: Quotation): LineItem[] {
  if (quotation.productIds.length === 0) return [emptyLineItem()];
  return quotation.productIds.map((productId, index) => ({
    mode: productId === null ? "custom" : "catalogue",
    productId: productId === null ? null : String(productId),
    productName: quotation.productNames[index] ?? "",
    imagePath: quotation.imagePaths[index] ?? "",
    quantity: quotation.quantities[index] ?? 1,
    rate: String(quotation.rates[index] ?? ""),
    taxPerc: String(quotation.taxPercs[index] ?? ""),
  }));
}

export function QuotationFormModal({
  mode,
  initialQuotation,
  customers,
  products,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialQuotation?: Quotation;
  customers: CustomerOption[];
  products: Product[];
  onClose: () => void;
  // No quotation payload back from save — the parent re-fetches the
  // authoritative list from GET /admin/get_quotation_details, same reasoning
  // as sales-orders-tab.tsx/invoices-tab.tsx's handleSaved.
  onSaved: () => void;
}) {
  const [customerMode, setCustomerMode] = useState<CustomerMode>(
    initialQuotation && initialQuotation.custId === null ? "custom" : "existing",
  );
  const [custId, setCustId] = useState<string | null>(
    initialQuotation?.custId != null ? String(initialQuotation.custId) : null,
  );
  const [customerName, setCustomerName] = useState(initialQuotation?.customerName ?? "");
  const [customerAddress, setCustomerAddress] = useState(initialQuotation?.customerAddress ?? "");
  const [date, setDate] = useState(initialQuotation ? toDateValue(initialQuotation.date) : nowAsDateValue());
  const [validTill, setValidTill] = useState(
    initialQuotation
      ? toDateValue(initialQuotation.validTill)
      : addDaysToDateValue(nowAsDateValue(), VALID_TILL_DAYS),
  );
  const [quotationStatus, setQuotationStatus] = useState<QuotationStatus>(initialQuotation?.status ?? "draft");
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialQuotation ? lineItemsFromQuotation(initialQuotation) : [emptyLineItem()],
  );
  const [description, setDescription] = useState(initialQuotation?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Which line's image is mid-upload (disables its inputs) and any error from
  // that upload — kept separate from `error`, since uploading happens
  // immediately and independently of the Save button, same as
  // product-form-modal.tsx's image rows.
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const wasDeleted = initialQuotation?.isDeleted ?? false;
  const title = isEdit ? "Edit quotation" : "New quotation";

  const customerOptions: SingleSelectOption[] = customers.map((customer) => ({
    value: String(customer.id),
    label: customer.name,
    isDeleted: customer.isDeleted,
  }));

  // Soft-deleted products are the ones kept out — is_visible only governs the
  // storefront, so a product hidden from customers is still perfectly
  // orderable/quotable/invoiceable here. `products` itself is deliberately
  // unfiltered (get_product_details returns deleted ones too) so an existing
  // line item pointing at a since-deleted product still resolves a name;
  // it's only the picker that hides them.
  const productOptions: SingleSelectOption[] = useMemo(
    () =>
      products
        .filter((product) => !product.isDeleted)
        .map((product) => ({ value: String(product.id), label: product.productName, isDeleted: false })),
    [products],
  );
  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

  function lineItemTotals(item: LineItem) {
    const lineBeforeTax = item.quantity * (Number(item.rate) || 0);
    const taxAmount = lineBeforeTax * ((Number(item.taxPerc) || 0) / 100);
    return { lineBeforeTax, taxAmount, lineTotal: lineBeforeTax + taxAmount };
  }

  const totalAmountBeforeTax = lineItems.reduce((sum, item) => sum + lineItemTotals(item).lineBeforeTax, 0);
  const totalTaxAmount = lineItems.reduce((sum, item) => sum + lineItemTotals(item).taxAmount, 0);
  const totalAmountAfterTax = totalAmountBeforeTax + totalTaxAmount;

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  function handleProductChange(index: number, productId: string) {
    const product = productsById.get(productId);
    updateLineItem(index, {
      productId,
      rate: product ? String(product.discountedPrice) : "",
      taxPerc: product ? String(product.gstPerc) : "",
    });
  }

  // Reuses /admin/upload_product_image, which writes nothing to disk — it
  // just echoes the bytes back base64-encoded (see routes/products.py) — so
  // the image ends up stored inline on the quotation as a data URI. That
  // suits a one-off line, whose image has nothing to belong to once the
  // quotation is gone; a catalogue product's image goes on being served
  // from /media as usual.
  async function handleImageFileChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so re-picking the same file after a failed upload still fires
    // a change event.
    event.target.value = "";
    if (!file) return;

    setUploadingImageIndex(index);
    setImageUploadError(null);

    try {
      const url = await uploadProductImage(file);
      updateLineItem(index, { imagePath: url });
    } catch {
      setImageUploadError("Couldn't upload image. Please try again.");
    } finally {
      setUploadingImageIndex(null);
    }
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function buildLineItemsPayload() {
    return lineItems.map((item) => ({
      // Only the active side of the either/or goes out — anything parked on
      // the other side is a leftover from toggling, and sending both would
      // be rejected by the backend's per-line validator.
      productId: item.mode === "catalogue" ? Number(item.productId) : null,
      productName: item.mode === "custom" ? item.productName.trim() : "",
      imagePath: item.mode === "custom" ? item.imagePath.trim() || null : null,
      quantity: item.quantity,
      rate: Number(item.rate) || 0,
      taxPerc: Number(item.taxPerc) || 0,
    }));
  }

  // Same either/or discipline as buildLineItemsPayload, for the buyer.
  function buildCustomerPayload() {
    return {
      custId: customerMode === "existing" ? Number(custId) : null,
      customerName: customerMode === "custom" ? customerName.trim() : "",
      customerAddress: customerMode === "custom" ? customerAddress.trim() : "",
    };
  }

  // Shared by the normal Save button and the delete/restore action below.
  async function submitEdit(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    try {
      const response = await updateQuotation({
        id: initialQuotation!.id,
        status: quotationStatus,
        isDeleted: isDeletedValue,
        ...buildCustomerPayload(),
        date,
        validTill,
        description,
        lineItems: buildLineItemsPayload(),
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

  // Create + immediately generate the PDF — the "fill the form, hit
  // Generate" flow described in the task. createQuotation throws (with the
  // backend's detail message folded in) rather than returning a Response, so
  // this doesn't need the ok-check dance submitEdit above still needs
  // (updateQuotation goes through the shared apiFetch wrapper directly).
  async function submitCreateAndGenerate() {
    setStatus("saving");
    setError(null);

    try {
      const { id, quotationNo } = await createQuotation({
        ...buildCustomerPayload(),
        date,
        validTill,
        description,
        lineItems: buildLineItemsPayload(),
      });

      try {
        await downloadQuotationPdf(id, quotationNo);
      } catch {
        // The quotation itself was created successfully — a failed PDF
        // download (e.g. a flaky connection right after save) shouldn't
        // block closing the form; the PDF can always be re-downloaded from
        // the tab's table afterward.
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

    // The customer picker and the per-line product picker are custom
    // dropdowns rather than <select>s, so checkValidity() can't see them —
    // both are checked by hand here. Every other required field (the one-off
    // name inputs included) carries `required` and is covered below.
    if (customerMode === "existing" && !custId) {
      setError("Please select a customer.");
      return;
    }

    const unpickedLine = lineItems.findIndex((item) => item.mode === "catalogue" && !item.productId);
    if (unpickedLine !== -1) {
      setError(`Please select a product on line ${unpickedLine + 1}, or switch it to a one-off item.`);
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
        aria-labelledby="quotation-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="quotation-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Quotation no.</span>
              <p className={styles.pageSubtext}>
                {isEdit ? initialQuotation?.quotationNo : "Assigned automatically on save"}
              </p>
            </div>

            <div className={styles.formGridFullSpan}>
              <span className={styles.formLabel}>Customer</span>
              <div
                className={`${styles.viewToggle} ${styles.inlineViewToggle}`}
                role="tablist"
                aria-label="Customer source"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={customerMode === "existing"}
                  onClick={() => setCustomerMode("existing")}
                  className={`${styles.viewToggleButton} ${
                    customerMode === "existing" ? styles.viewToggleButtonActive : ""
                  }`}
                >
                  Existing customer
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={customerMode === "custom"}
                  onClick={() => setCustomerMode("custom")}
                  className={`${styles.viewToggleButton} ${
                    customerMode === "custom" ? styles.viewToggleButtonActive : ""
                  }`}
                >
                  One-off customer
                </button>
              </div>
              {customerMode === "custom" && (
                <p className={styles.pageSubtext}>
                  Used on this quotation only — it won&apos;t be added to your clients.
                </p>
              )}
            </div>

            {customerMode === "existing" ? (
              <SingleSelectDropdown
                label="Customer"
                placeholder="Select a customer"
                entityLabel="customers"
                hideLabel
                required
                // Active/Deleted toggle removed — only active customers are
                // browsable here. A deleted customer already assigned to this
                // quotation still resolves and displays correctly
                // (customerOptions includes deleted rows), it's just not
                // selectable going forward.
                showStatusFilter={false}
                options={customerOptions}
                selectedValue={custId}
                onChange={setCustId}
              />
            ) : (
              <>
                <div>
                  <label htmlFor="quotationCustomerName" className={styles.formLabel}>
                    Name<span className={styles.requiredMark}>*</span>
                  </label>
                  <input
                    id="quotationCustomerName"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className={styles.formInput}
                  />
                </div>

                <div>
                  <label htmlFor="quotationCustomerAddress" className={styles.formLabel}>
                    Address
                  </label>
                  <input
                    id="quotationCustomerAddress"
                    type="text"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    className={styles.formInput}
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="quotationDate" className={styles.formLabel}>
                Issue date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="quotationDate"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="validTill" className={styles.formLabel}>
                Valid till<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="validTill"
                type="date"
                required
                value={validTill}
                onChange={(e) => setValidTill(e.target.value)}
                className={styles.formInput}
              />
            </div>

            {isEdit && (
              <SingleSelectDropdown
                label="Status"
                placeholder="Select a status"
                entityLabel="statuses"
                required
                showStatusFilter={false}
                options={STATUS_OPTIONS}
                selectedValue={quotationStatus}
                onChange={(value) => setQuotationStatus(value as QuotationStatus)}
              />
            )}
          </div>

          <div className={styles.lineItemsSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Line items</span>
              <button type="button" onClick={addLineItem} className={styles.addContactButton}>
                + Add line item
              </button>
            </div>

            <div className={styles.quotationLineItemsHeaderRow}>
              <span className={styles.formLabel}>Type</span>
              <span className={styles.formLabel}>Product</span>
              <span className={styles.formLabel}>
                Quantity<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Rate<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Tax %<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>Tax amount</span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {lineItems.map((item, index) => {
              const { taxAmount, lineTotal } = lineItemTotals(item);
              const isUploading = uploadingImageIndex === index;
              const imagePath = item.imagePath.trim();
              return (
                <div key={index} className={styles.quotationLineItemGroup}>
                  <div className={styles.quotationLineItemRow}>
                    {/* Switching to one-off deliberately leaves rate/tax % as
                        they are: the usual reason to switch is "same terms,
                        but this item isn't in the catalogue". */}
                    <select
                      value={item.mode}
                      onChange={(e) => updateLineItem(index, { mode: e.target.value as LineItemMode })}
                      aria-label={`Line ${index + 1} type`}
                      className={styles.formInput}
                    >
                      <option value="catalogue">Catalogue</option>
                      <option value="custom">One-off</option>
                    </select>

                    {item.mode === "catalogue" ? (
                      <SingleSelectDropdown
                        label={`Line ${index + 1} product`}
                        placeholder="Select a product…"
                        entityLabel="products"
                        hideLabel
                        showStatusFilter={false}
                        options={productOptions}
                        selectedValue={item.productId}
                        onChange={(value) => handleProductChange(index, value)}
                      />
                    ) : (
                      <input
                        type="text"
                        required
                        placeholder="Item name"
                        value={item.productName}
                        onChange={(e) => updateLineItem(index, { productName: e.target.value })}
                        aria-label={`Line ${index + 1} item name`}
                        className={styles.formInput}
                      />
                    )}

                    <input
                      type="number"
                      min={1}
                      required
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, { quantity: Number(e.target.value) })}
                      aria-label={`Line ${index + 1} quantity`}
                      className={styles.formInput}
                    />

                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={item.rate}
                      onChange={(e) => updateLineItem(index, { rate: sanitizeDecimalInput(e.target.value) })}
                      aria-label={`Line ${index + 1} rate`}
                      className={styles.formInput}
                    />

                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={item.taxPerc}
                      onChange={(e) => updateLineItem(index, { taxPerc: sanitizeDecimalInput(e.target.value) })}
                      aria-label={`Line ${index + 1} tax percent`}
                      className={styles.formInput}
                    />

                    <input
                      type="text"
                      disabled
                      value={`₹${taxAmount.toFixed(2)}`}
                      aria-label={`Line ${index + 1} tax amount`}
                      className={styles.formInput}
                    />

                    <input
                      type="text"
                      disabled
                      value={`₹${lineTotal.toFixed(2)}`}
                      aria-label={`Line ${index + 1} total`}
                      className={styles.formInput}
                    />

                    <button
                      type="button"
                      onClick={() => removeLineItem(index)}
                      disabled={lineItems.length === 1}
                      aria-label={`Remove line ${index + 1}`}
                      className={styles.removeContactButton}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {/* A catalogue line takes its image from the product it
                      points at, so only a one-off line needs one supplied
                      here — and it stays optional. */}
                  {item.mode === "custom" && (
                    <div className={styles.quotationCustomImageRow}>
                      {imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset
                        <img
                          src={resolveMediaUrl(imagePath)}
                          alt=""
                          className={styles.quotationImageThumb}
                          onError={(e) => {
                            e.currentTarget.style.opacity = "0";
                          }}
                        />
                      ) : (
                        <div className={styles.quotationImageThumbEmpty}>
                          <CubeIcon className="h-5 w-5" />
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder="Upload an image, or paste an image URL (optional)"
                        value={item.imagePath}
                        onChange={(e) => updateLineItem(index, { imagePath: e.target.value })}
                        disabled={isUploading}
                        aria-label={`Line ${index + 1} image`}
                        className={styles.formInput}
                      />
                      <label
                        htmlFor={`quotationLineImage-${index}`}
                        className={`${styles.uploadImageButton} ${isUploading ? styles.uploadImageButtonDisabled : ""}`}
                        aria-label={`Upload line ${index + 1} image`}
                      >
                        <ArrowUpTrayIcon className="h-4 w-4" />
                      </label>
                      <input
                        id={`quotationLineImage-${index}`}
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleImageFileChange(index, e)}
                        disabled={isUploading}
                        className="sr-only"
                      />
                      {isUploading && <p className={styles.pageSubtext}>Uploading…</p>}
                    </div>
                  )}
                </div>
              );
            })}

            {imageUploadError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {imageUploadError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="quotationDescription" className={styles.formLabel}>
              Description / scope (optional)
            </label>
            <textarea
              id="quotationDescription"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total before tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountBeforeTax.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total tax</p>
              <p className={styles.totalsRowValue}>₹{totalTaxAmount.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total after tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountAfterTax.toFixed(2)}</p>
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
                  {wasDeleted ? "Restore quotation" : "Delete quotation"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this quotation?"
                      : "Are you sure you want to delete this quotation?"}
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
                      : "Generate quotation"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
