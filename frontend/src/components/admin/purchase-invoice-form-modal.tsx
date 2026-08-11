"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoiceFormModal> — add/edit popup on the Purchase Invoices tab
// ---------------------------------------------------------------------------
// Two creation paths, picked via a small source toggle (add mode only —
// fixed once raised, shown read-only in edit mode):
//   - "po_dropdown": pick an existing PurchaseOrders record; vendor and
//     totals are derived from it (live preview here, re-derived
//     authoritatively by the backend). No line-item entry — mirrors
//     invoice-form-modal.tsx borrowing a sales order's line items.
//   - "pdf_upload": upload a vendor PDF, best-effort parsed locally (see
//     purchase_invoice_parser.py — no LLM, every field stays editable) via
//     uploadAndParsePurchaseInvoicePdf, which stores the file immediately
//     and returns an uploadedPdfPath passed straight into the create
//     payload. Carries its own free-text line items (no product_id FK — a
//     vendor's line items don't reliably map to our catalogue).
// mode "add" -> POST /admin/create_new_purchase_invoice
// mode "edit" -> POST /admin/update_purchase_invoice_details (source/poId/
//                uploadedPdfPath immutable; line items only editable for
//                the pdf_upload source, since po_dropdown's keep coming
//                live from the linked PurchaseOrders).
// Both live in backend/app/api/routes/purchase_invoices.py.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import { GST_PERCENT_OPTIONS } from "@/lib/gst";
import type { PurchaseOrder } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import {
  createPurchaseInvoice,
  updatePurchaseInvoice,
  uploadAndParsePurchaseInvoicePdf,
  type PurchaseInvoice,
  type PurchaseInvoiceLineItem,
  type PurchaseInvoiceSource,
} from "@/lib/purchase-invoices";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

type LineItem = {
  description: string;
  quantity: string;
  rate: string;
  taxPerc: string;
};

function emptyLineItem(): LineItem {
  return { description: "", quantity: "1", rate: "", taxPerc: "0" };
}

function lineItemsToState(items: PurchaseInvoiceLineItem[]): LineItem[] {
  if (items.length === 0) return [emptyLineItem()];
  return items.map((item) => ({
    description: item.description,
    quantity: String(item.quantity),
    rate: String(item.rate),
    taxPerc: String(item.taxPerc),
  }));
}

export function PurchaseInvoiceFormModal({
  mode,
  initialPurchaseInvoice,
  initialLineItems,
  vendors,
  purchaseOrders,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialPurchaseInvoice?: PurchaseInvoice;
  // Only meaningful for an existing pdf_upload-source row.
  initialLineItems?: PurchaseInvoiceLineItem[];
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const [source, setSource] = useState<PurchaseInvoiceSource>(initialPurchaseInvoice?.source ?? "po_dropdown");
  const [vendorId, setVendorId] = useState<string | null>(
    initialPurchaseInvoice ? String(initialPurchaseInvoice.vendorId) : null,
  );
  const [poId, setPoId] = useState<string | null>(
    initialPurchaseInvoice?.poId ? String(initialPurchaseInvoice.poId) : null,
  );
  const [date, setDate] = useState(
    initialPurchaseInvoice ? toDatetimeLocalValue(initialPurchaseInvoice.date) : nowAsDatetimeLocalValue(),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialLineItems ? lineItemsToState(initialLineItems) : [emptyLineItem()],
  );
  const [uploadedPdfPath, setUploadedPdfPath] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const wasDeleted = initialPurchaseInvoice?.isDeleted ?? false;
  const title = isEdit ? "Edit purchase invoice" : "New purchase invoice";
  const isPoDropdown = source === "po_dropdown";

  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
    isDeleted: false,
  }));
  const vendorsById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const poOptions: SingleSelectOption[] = purchaseOrders.map((po) => ({
    value: String(po.id),
    label: `PO-${po.purchaseOrderNo} · ${vendorsById.get(po.vendorId)?.name ?? "Unknown vendor"}`,
    isDeleted: false,
  }));
  const selectedPo = purchaseOrders.find((po) => String(po.id) === poId) ?? null;

  function handlePoChange(newPoId: string | null) {
    setPoId(newPoId);
    const po = purchaseOrders.find((p) => String(p.id) === newPoId);
    if (po) setVendorId(String(po.vendorId));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParsing(true);
    setError(null);
    try {
      const { uploadedPdfPath: path, parsed } = await uploadAndParsePurchaseInvoicePdf(file);
      setUploadedPdfPath(path);
      if (parsed.suggestedVendorId) setVendorId(String(parsed.suggestedVendorId));
      if (parsed.date) setDate(toDatetimeLocalValue(parsed.date));
      if (parsed.lineItems.length > 0) {
        setLineItems(
          parsed.lineItems.map((item) => ({
            description: item.description,
            quantity: item.quantity != null ? String(item.quantity) : "1",
            rate: item.rate != null ? String(item.rate) : "",
            taxPerc: "0",
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse the uploaded PDF.");
    } finally {
      setParsing(false);
    }
  }

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const parsedLineItems: PurchaseInvoiceLineItem[] = lineItems.map((item) => ({
    description: item.description,
    hsnCode: "",
    quantity: Number(item.quantity) || 0,
    rate: Number(item.rate) || 0,
    taxPerc: Number(item.taxPerc) || 0,
  }));

  const totalAmountBeforeTax = isPoDropdown
    ? (selectedPo?.totalAmountBeforeTax ?? 0)
    : parsedLineItems.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  const totalAmountAfterTax = isPoDropdown
    ? (selectedPo?.totalAmountAfterTax ?? 0)
    : parsedLineItems.reduce((sum, item) => sum + item.quantity * item.rate * (1 + item.taxPerc / 100), 0);
  const totalTaxAmount = totalAmountAfterTax - totalAmountBeforeTax;

  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    try {
      const response =
        isEdit && initialPurchaseInvoice
          ? await updatePurchaseInvoice({
              id: initialPurchaseInvoice.id,
              date: fromDatetimeLocalValue(date),
              vendorId: Number(vendorId),
              lineItems: isPoDropdown ? undefined : parsedLineItems,
              isDeleted: isDeletedValue,
            })
          : await createPurchaseInvoice({
              date: fromDatetimeLocalValue(date),
              vendorId: Number(vendorId),
              source,
              poId: poId ? Number(poId) : undefined,
              uploadedPdfPath: uploadedPdfPath ?? undefined,
              lineItems: isPoDropdown ? undefined : parsedLineItems,
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }
    if (!isEdit && isPoDropdown && !poId) {
      setError("Please select a purchase order.");
      return;
    }
    if (!isEdit && !isPoDropdown && !uploadedPdfPath) {
      setError("Please upload a vendor PDF.");
      return;
    }
    if (!isPoDropdown && parsedLineItems.some((item) => !item.description || item.quantity <= 0 || item.rate <= 0)) {
      setError("Every line item needs a description, quantity, and rate.");
      return;
    }

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
        aria-labelledby="purchase-invoice-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="purchase-invoice-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {!isEdit && (
            <div className={styles.viewToggle} role="tablist" aria-label="Purchase invoice source">
              <button
                type="button"
                role="tab"
                aria-selected={isPoDropdown}
                onClick={() => setSource("po_dropdown")}
                className={`${styles.viewToggleButton} ${isPoDropdown ? styles.viewToggleButtonActive : ""}`}
              >
                From purchase order
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isPoDropdown}
                onClick={() => setSource("pdf_upload")}
                className={`${styles.viewToggleButton} ${!isPoDropdown ? styles.viewToggleButtonActive : ""}`}
              >
                From uploaded PDF
              </button>
            </div>
          )}

          <div className={styles.formGrid}>
            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Purchase invoice no.</span>
                <p className={styles.pageSubtext}>{initialPurchaseInvoice?.purchaseInvoiceNoDisplay}</p>
              </div>
            ) : (
              <div>
                <span className={styles.formLabel}>Purchase invoice no.</span>
                <p className={styles.pageSubtext}>Assigned automatically on save</p>
              </div>
            )}

            {isPoDropdown ? (
              isEdit ? (
                <div>
                  <span className={styles.formLabel}>Purchase order</span>
                  <p className={styles.pageSubtext}>
                    {selectedPo ? `PO-${selectedPo.purchaseOrderNo}` : "—"}
                  </p>
                </div>
              ) : (
                <SingleSelectDropdown
                  label="Purchase order"
                  placeholder="Select a purchase order"
                  entityLabel="purchase orders"
                  required
                  showStatusFilter={false}
                  options={poOptions}
                  selectedValue={poId}
                  onChange={handlePoChange}
                />
              )
            ) : (
              <div>
                <span className={styles.formLabel}>
                  Vendor PDF{!isEdit && <span className={styles.requiredMark}>*</span>}
                </span>
                {isEdit ? (
                  <p className={styles.pageSubtext}>
                    {initialPurchaseInvoice?.hasUploadedPdf ? "Uploaded" : "—"}
                  </p>
                ) : (
                  <>
                    <label className={styles.triggerButtonBase} style={{ display: "inline-block", cursor: "pointer" }}>
                      {parsing ? "Parsing…" : uploadedPdfPath ? "Replace file" : "Choose PDF"}
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleFileChange}
                        disabled={parsing}
                        style={{ display: "none" }}
                      />
                    </label>
                    {uploadedPdfPath && !parsing && (
                      <p className={styles.pageSubtext}>Uploaded — fields prefilled below where possible.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {isPoDropdown ? (
              <div>
                <span className={styles.formLabel}>Vendor</span>
                <p className={styles.pageSubtext}>{vendorsById.get(Number(vendorId))?.name ?? "—"}</p>
              </div>
            ) : (
              <SingleSelectDropdown
                label="Vendor"
                placeholder="Select a vendor"
                entityLabel="vendors"
                required
                showStatusFilter={false}
                options={vendorOptions}
                selectedValue={vendorId}
                onChange={setVendorId}
              />
            )}

            <div>
              <label htmlFor="purchaseInvoiceDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="purchaseInvoiceDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          {!isPoDropdown && (
            <div className={styles.lineItemsSection}>
              <div className={styles.contactsHeader}>
                <span className={styles.formLabel}>Line items</span>
                <button type="button" onClick={addLineItem} className={styles.addContactButton}>
                  + Add line item
                </button>
              </div>

              <div className={styles.salesLineItemsHeaderRow}>
                <span className={styles.formLabel}>
                  Description<span className={styles.requiredMark}>*</span>
                </span>
                <span className={styles.formLabel}>
                  Quantity<span className={styles.requiredMark}>*</span>
                </span>
                <span className={styles.formLabel}>
                  Rate<span className={styles.requiredMark}>*</span>
                </span>
                <span className={styles.formLabel}>Tax %</span>
                <span className={styles.formLabel}>Tax amount</span>
                <span className={styles.formLabel}>Total</span>
                <span />
              </div>

              {lineItems.map((item, index) => {
                const quantity = Number(item.quantity) || 0;
                const rate = Number(item.rate) || 0;
                const taxPerc = Number(item.taxPerc) || 0;
                const taxableValue = quantity * rate;
                const taxAmount = taxableValue * (taxPerc / 100);
                return (
                  <div key={index} className={styles.salesLineItemRow}>
                    <input
                      type="text"
                      required
                      value={item.description}
                      onChange={(e) => updateLineItem(index, { description: e.target.value })}
                      aria-label={`Line ${index + 1} description`}
                      className={styles.formInput}
                    />

                    <input
                      type="number"
                      min={1}
                      required
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, { quantity: e.target.value })}
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

                    <select
                      value={item.taxPerc}
                      onChange={(e) => updateLineItem(index, { taxPerc: e.target.value })}
                      aria-label={`Line ${index + 1} tax percent`}
                      className={styles.formInput}
                    >
                      {GST_PERCENT_OPTIONS.map((percent) => (
                        <option key={percent} value={percent}>
                          {percent}%
                        </option>
                      ))}
                    </select>

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
                      value={`₹${(taxableValue + taxAmount).toFixed(2)}`}
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
          )}

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
                      ? "Are you sure you want to restore this purchase invoice?"
                      : "Are you sure you want to void this purchase invoice?"}
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
                <Button type="submit" variant="primary" disabled={status === "saving" || parsing}>
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
