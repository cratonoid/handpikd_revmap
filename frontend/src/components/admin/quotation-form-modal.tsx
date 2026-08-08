"use client";

// ---------------------------------------------------------------------------
// <QuotationFormModal> — add/edit popup on the Quotation tab of /admin/quotation
// ---------------------------------------------------------------------------
// Line-item structure mirrors sales-order-form-modal.tsx exactly (a product
// picker auto-fills rate/tax % from the product but both stay editable, "+
// Add line item" / per-row remove). Two dates instead of one:
//   - date       -> issue date, defaults to "now"
//   - validTill  -> defaults to issue date + 10 days (addDaysToDatetimeLocalValue)
// Both stay freely editable afterward, same as every other date field here.
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
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import {
  addDaysToDatetimeLocalValue,
  fromDatetimeLocalValue,
  nowAsDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/datetime-input";
import type { Quotation, QuotationStatus } from "@/lib/quotations";
import { createQuotation, downloadQuotationPdf, updateQuotation } from "@/lib/quotations";
import type { CustomerOption } from "@/lib/customers";
import type { Product } from "@/lib/products";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const VALID_TILL_DAYS = 10;

const STATUS_OPTIONS: SingleSelectOption[] = [
  { value: "draft", label: "Draft", isDeleted: false },
  { value: "sent", label: "Sent", isDeleted: false },
  { value: "accepted", label: "Accepted", isDeleted: false },
  { value: "rejected", label: "Rejected", isDeleted: false },
  { value: "expired", label: "Expired", isDeleted: false },
];

type LineItem = {
  productId: string | null;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput — same reasoning as
  // sales-order-form-modal.tsx's LineItem.rate.
  rate: string;
  taxPerc: string;
};

function emptyLineItem(): LineItem {
  return { productId: null, quantity: 1, rate: "", taxPerc: "" };
}

// Reassembles an existing quotation's parallel productIds/quantities/rates/
// taxPercs arrays (see lib/quotations.ts) back into per-line-item rows.
function lineItemsFromQuotation(quotation: Quotation): LineItem[] {
  if (quotation.productIds.length === 0) return [emptyLineItem()];
  return quotation.productIds.map((productId, index) => ({
    productId: String(productId),
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
  const [custId, setCustId] = useState<string | null>(
    initialQuotation ? String(initialQuotation.custId) : null,
  );
  const [date, setDate] = useState(
    initialQuotation ? toDatetimeLocalValue(initialQuotation.date) : nowAsDatetimeLocalValue(),
  );
  const [validTill, setValidTill] = useState(
    initialQuotation
      ? toDatetimeLocalValue(initialQuotation.validTill)
      : addDaysToDatetimeLocalValue(nowAsDatetimeLocalValue(), VALID_TILL_DAYS),
  );
  const [quotationStatus, setQuotationStatus] = useState<QuotationStatus>(initialQuotation?.status ?? "draft");
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialQuotation ? lineItemsFromQuotation(initialQuotation) : [emptyLineItem()],
  );
  const [description, setDescription] = useState(initialQuotation?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialQuotation?.isDeleted ?? false;
  const title = isEdit ? "Edit quotation" : "New quotation";

  const customerOptions: SingleSelectOption[] = customers.map((customer) => ({
    value: String(customer.id),
    label: customer.name,
    isDeleted: customer.isDeleted,
  }));

  const productOptions: SingleSelectOption[] = useMemo(
    () =>
      products
        .filter((product) => product.isVisible)
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

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function buildLineItemsPayload() {
    return lineItems.map((item) => ({
      productId: Number(item.productId),
      quantity: item.quantity,
      rate: Number(item.rate) || 0,
      taxPerc: Number(item.taxPerc) || 0,
    }));
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
        custId: Number(custId),
        date: fromDatetimeLocalValue(date),
        validTill: fromDatetimeLocalValue(validTill),
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
        custId: Number(custId),
        date: fromDatetimeLocalValue(date),
        validTill: fromDatetimeLocalValue(validTill),
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

    if (!custId) {
      setError("Please select a customer.");
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
            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Quotation no.</span>
                <p className={styles.pageSubtext}>{initialQuotation?.quotationNo}</p>
              </div>
            ) : (
              <div>
                <span className={styles.formLabel}>Quotation no.</span>
                <p className={styles.pageSubtext}>Assigned automatically on save</p>
              </div>
            )}

            <SingleSelectDropdown
              label="Customer"
              placeholder="Select a customer"
              entityLabel="customers"
              required
              options={customerOptions}
              selectedValue={custId}
              onChange={setCustId}
            />

            <div>
              <label htmlFor="quotationDate" className={styles.formLabel}>
                Issue date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="quotationDate"
                type="datetime-local"
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
                type="datetime-local"
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

            <div className={styles.salesLineItemsHeaderRow}>
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
              return (
                <div key={index} className={styles.salesLineItemRow}>
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
              );
            })}
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
