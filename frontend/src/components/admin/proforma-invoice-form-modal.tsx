"use client";

// ---------------------------------------------------------------------------
// <ProformaInvoiceFormModal> — add/edit popup on the Proforma view of /admin/invoices
// ---------------------------------------------------------------------------
// Adapted from quotation-form-modal.tsx — a proforma invoice is raised the
// same way as a quotation (own customer + line items, no sales order/
// quotation involved), just with a due date instead of a valid-till date and
// no status dropdown (a proforma invoice has no lifecycle field, only
// is_deleted).
//   - mode "add"  -> POST /admin/create_new_proforma_invoice, then
//                    immediately downloads the generated PDF
//                    (createProformaInvoice returns the new id/
//                    invoiceNoDisplay precisely so this can chain straight
//                    into downloadInvoicePdf without a re-fetch).
//   - mode "edit" -> POST /admin/update_proforma_invoice_details.
// Both live in backend/app/api/routes/invoices.py.
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import {
  addDaysToDatetimeLocalValue,
  fromDatetimeLocalValue,
  nowAsDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/datetime-input";
import type { Invoice } from "@/lib/invoices";
import { createProformaInvoice, downloadInvoicePdf, updateProformaInvoice } from "@/lib/invoices";
import type { CustomerOption } from "@/lib/customers";
import type { Product } from "@/lib/products";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const DUE_DATE_DAYS = 10;

type LineItem = {
  productId: string | null;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput — same reasoning as
  // quotation-form-modal.tsx's LineItem.rate.
  rate: string;
  taxPerc: string;
};

function emptyLineItem(): LineItem {
  return { productId: null, quantity: 1, rate: "", taxPerc: "" };
}

// Reassembles an existing invoice's parallel productIds/quantities/rates/
// taxPercs arrays (see lib/invoices.ts) back into per-line-item rows.
function lineItemsFromInvoice(invoice: Invoice): LineItem[] {
  if (invoice.productIds.length === 0) return [emptyLineItem()];
  return invoice.productIds.map((productId, index) => ({
    productId: String(productId),
    quantity: invoice.quantities[index] ?? 1,
    rate: String(invoice.rates[index] ?? ""),
    taxPerc: String(invoice.taxPercs[index] ?? ""),
  }));
}

export function ProformaInvoiceFormModal({
  mode,
  initialInvoice,
  customers,
  products,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialInvoice?: Invoice;
  customers: CustomerOption[];
  products: Product[];
  onClose: () => void;
  // No invoice payload back from save — the parent re-fetches the
  // authoritative list from GET /admin/get_invoice_details, same reasoning
  // as invoices-tab.tsx's handleSaved.
  onSaved: () => void;
}) {
  const [custId, setCustId] = useState<string | null>(
    initialInvoice?.custId ? String(initialInvoice.custId) : null,
  );
  const [date, setDate] = useState(
    initialInvoice ? toDatetimeLocalValue(initialInvoice.date) : nowAsDatetimeLocalValue(),
  );
  const [dueDate, setDueDate] = useState(
    initialInvoice
      ? toDatetimeLocalValue(initialInvoice.dueDate)
      : addDaysToDatetimeLocalValue(nowAsDatetimeLocalValue(), DUE_DATE_DAYS),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialInvoice ? lineItemsFromInvoice(initialInvoice) : [emptyLineItem()],
  );
  const [description, setDescription] = useState(initialInvoice?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialInvoice?.isDeleted ?? false;
  const title = isEdit ? "Edit proforma invoice" : "New proforma invoice";

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
      const response = await updateProformaInvoice({
        id: initialInvoice!.id,
        isDeleted: isDeletedValue,
        custId: Number(custId),
        date: fromDatetimeLocalValue(date),
        dueDate: fromDatetimeLocalValue(dueDate),
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
  // Generate" flow, same as quotation-form-modal.tsx's
  // submitCreateAndGenerate.
  async function submitCreateAndGenerate() {
    setStatus("saving");
    setError(null);

    try {
      const { id, invoiceNoDisplay } = await createProformaInvoice({
        custId: Number(custId),
        date: fromDatetimeLocalValue(date),
        dueDate: fromDatetimeLocalValue(dueDate),
        description,
        lineItems: buildLineItemsPayload(),
      });

      try {
        await downloadInvoicePdf(id, invoiceNoDisplay);
      } catch {
        // The invoice itself was created successfully — a failed PDF
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
        aria-labelledby="proforma-invoice-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="proforma-invoice-modal-title" className={styles.modalTitle}>
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
                <span className={styles.formLabel}>Invoice no.</span>
                <p className={styles.pageSubtext}>{initialInvoice?.invoiceNoDisplay}</p>
              </div>
            ) : (
              <div>
                <span className={styles.formLabel}>Invoice no.</span>
                <p className={styles.pageSubtext}>Assigned automatically on save</p>
              </div>
            )}

            <SingleSelectDropdown
              label="Customer"
              placeholder="Select a customer"
              entityLabel="customers"
              required
              // Active/Deleted toggle removed — only active customers are
              // browsable here, same as quotation-form-modal.tsx.
              showStatusFilter={false}
              options={customerOptions}
              selectedValue={custId}
              onChange={setCustId}
            />

            <div>
              <label htmlFor="proformaInvoiceDate" className={styles.formLabel}>
                Issue date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="proformaInvoiceDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="proformaDueDate" className={styles.formLabel}>
                Due date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="proformaDueDate"
                type="datetime-local"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={styles.formInput}
              />
            </div>
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
            <label htmlFor="proformaInvoiceDescription" className={styles.formLabel}>
              Description / scope (optional)
            </label>
            <textarea
              id="proformaInvoiceDescription"
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
                  {wasDeleted ? "Restore invoice" : "Void invoice"}
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    {wasDeleted
                      ? "Are you sure you want to restore this invoice?"
                      : "Are you sure you want to void this invoice?"}
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
                    {status === "saving" ? "Saving…" : wasDeleted ? "Yes, restore" : "Yes, void"}
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
                      : "Generate proforma invoice"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
