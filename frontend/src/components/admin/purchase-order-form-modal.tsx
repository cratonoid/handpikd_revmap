"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrderFormModal> — add/edit popup on the Purchase orders tab of
// /admin/orders
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendor-form-modal.tsx's add/edit split (no
// delete/restore here, though — PurchaseOrders has no is_deleted-style flag,
// unlike VendorDetails):
//   - mode "add"  -> POST /admin/create_new_purchase_order
//   - mode "edit" -> POST /admin/update_purchase_order_details (existing
//                    order, looked up by id)
// Both live in backend/app/api/routes/orders.py.
//
// This is the form the vendor and product APIs feed into:
//   - Vendor (SingleSelectDropdown) is populated from GET /admin/get_vendors_list
//     (lib/vendors.ts — a lightweight id+name list of active vendors).
//   - Each line item's product <select> is populated from
//     GET /admin/get_product_details (lib/products.ts), filtered down to the
//     chosen vendor's own products, and stays disabled with no options until
//     a vendor is picked. Picking a product auto-fills that line's rate from
//     the product's vendor_rate, which the admin can still override.
// total_amount_before_tax / total_amount_after_tax are computed here for
// display, but the backend re-derives them server-side from the submitted
// product_ids/quantities/rates rather than trusting these fields.
//
// Line items are submitted as parallel product_ids/quantities/rates arrays
// (see CreateNewPurchaseOrderRequest in backend/app/schemas/purchase_orders.py),
// each persisted as its own #purchase_summary row tied back to the new
// purchase order via purchase_order_id.
//
// In "add" mode the form can arrive pre-filled from a vendor's own invoice
// PDF (the `prefill` prop, read by components/admin/
// purchase-invoice-upload-modal.tsx) — every field stays editable, since the
// point of that path is that the admin reviews what was read before it
// saves. Either way, saving also raises the order's purchase invoice
// server-side, and the vendor PDF — the uploaded one, or an optional one
// picked here — is attached to that invoice in a follow-up request once it
// has an id.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import { GST_PERCENT_OPTIONS, isIntraState, resolveStateCode, stateNameForCode } from "@/lib/gst";
import { attachPurchaseInvoicePdf } from "@/lib/purchase-invoices";
import type { ParsedPurchaseInvoice, PurchaseOrder } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import type { Product } from "@/lib/products";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

type LineItem = {
  productId: string | null;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput (see lib/decimal-input.ts)
  // rather than a controlled type="number" input, so a leading "0" can just
  // be typed over instead of leaving stray zeros until blur.
  rate: string;
};

function emptyLineItem(): LineItem {
  return { productId: null, quantity: 1, rate: "" };
}

// Reassembles an existing order's parallel productIds/quantities/rates
// arrays (see lib/purchase-orders.ts) back into per-line-item rows for the
// form's local state.
function lineItemsFromOrder(order: PurchaseOrder): LineItem[] {
  if (order.productIds.length === 0) return [emptyLineItem()];
  return order.productIds.map((productId, index) => ({
    productId: String(productId),
    quantity: order.quantities[index] ?? 1,
    rate: String(order.rates[index] ?? ""),
  }));
}

function lineItemsFromParsedInvoice(parsed: ParsedPurchaseInvoice): LineItem[] {
  if (parsed.lineItems.length === 0) return [emptyLineItem()];
  return parsed.lineItems.map((item) => ({
    productId: String(item.productId),
    quantity: item.quantity,
    rate: String(item.rate),
  }));
}

// The GST % dropdowns hold their value as text ("" for none), since that's
// what a <select> reads and writes.
function percentValue(percent: number | null | undefined): string {
  return percent != null ? String(percent) : "";
}

// GST_PERCENT_OPTIONS lists the standard slabs, but an intra-state purchase
// splits one of them in half (18% -> 9% SGST + 9% CGST), and a parsed
// invoice can carry a rate that isn't a slab at all. `halved` is what the
// SGST and CGST dropdowns pass once the form knows the purchase is
// intra-state, so the admin picks 9% out of a list of real half-slabs
// instead of hunting for it among the full ones. Folding the current value
// in keeps the dropdown able to show what's actually selected instead of
// silently falling back to "—".
function percentOptions(selected: string, halved = false): number[] {
  const slabs = halved ? GST_PERCENT_OPTIONS.map((percent) => percent / 2) : GST_PERCENT_OPTIONS;
  const value = Number(selected);
  if (!selected || !Number.isFinite(value) || slabs.includes(value)) {
    return slabs;
  }
  return [...slabs, value].sort((a, b) => a - b);
}

// One GST rate, expressed under the heads the supply's direction calls for:
// intra-state splits it in half across SGST and CGST, inter-state puts all of
// it on IGST. Mirrors split_tax in backend/app/services/gst.py.
function taxHeadsFor(intraState: boolean, totalPerc: number): { sgst: string; cgst: string; igst: string } {
  if (!totalPerc) return { sgst: "", cgst: "", igst: "" };
  return intraState
    ? { sgst: String(totalPerc / 2), cgst: String(totalPerc / 2), igst: "" }
    : { sgst: "", cgst: "", igst: String(totalPerc) };
}

export function PurchaseOrderFormModal({
  mode,
  initialOrder,
  prefill,
  initialPdfFile,
  vendors,
  products,
  ownStateCode,
  nextPurchaseOrderNo,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialOrder?: PurchaseOrder;
  // "add" mode only: values read off a vendor's invoice PDF, for review.
  prefill?: ParsedPurchaseInvoice;
  // The vendor's PDF, either the one that was parsed into `prefill` or one
  // picked here. Attached to the purchase invoice this order raises, once
  // the save returns its id.
  initialPdfFile?: File | null;
  vendors: VendorOption[];
  products: Product[];
  // Our own GST state code, from the company profile (see
  // purchase-orders-tab.tsx). Compared against the chosen vendor's state to
  // decide whether this order is taxed as SGST + CGST or IGST. "" if the
  // profile has no state on file, in which case the form stops guessing and
  // leaves all three heads open.
  ownStateCode: string;
  nextPurchaseOrderNo: string;
  onClose: () => void;
  // No order payload — the backend only returns {message} (see
  // create_new_purchase_order/update_purchase_order_details), so the parent
  // re-fetches the authoritative list from GET /admin/get_purchase_order_details
  // rather than the caller reconstructing one client-side (which is what
  // produced a fake id: 0 for new orders, breaking their very next edit).
  onSaved: () => void;
}) {
  const [vendorId, setVendorId] = useState<string | null>(
    initialOrder ? String(initialOrder.vendorId) : prefill ? String(prefill.vendorId) : null,
  );
  // An uploaded invoice's own number becomes the purchase order number, so
  // the order and the vendor's document are findable by the same string —
  // it's also what makes re-uploading the same invoice a conflict (see
  // _reject_if_already_recorded in the backend's purchase_invoice_intake).
  const [purchaseOrderNo, setPurchaseOrderNo] = useState(
    initialOrder?.purchaseOrderNo ?? prefill?.vendorInvoiceNo ?? nextPurchaseOrderNo,
  );
  const [date, setDate] = useState(
    initialOrder
      ? toDatetimeLocalValue(initialOrder.date)
      : prefill
        ? toDatetimeLocalValue(prefill.date)
        : nowAsDatetimeLocalValue(),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialOrder
      ? lineItemsFromOrder(initialOrder)
      : prefill
        ? lineItemsFromParsedInvoice(prefill)
        : [emptyLineItem()],
  );
  // Percentages (of the line items' subtotal), not rupee amounts — chosen
  // from the hardcoded GST_PERCENT_OPTIONS dropdown (see lib/gst.ts).
  // Indian GST rules mean a purchase order is taxed as EITHER sgstPerc +
  // cgstPerc (intra-state) OR igstPerc alone (inter-state), never both —
  // enforced in handleSubmit below.
  const [sgstPerc, setSgstPerc] = useState(percentValue(initialOrder?.sgstPerc ?? prefill?.sgstPerc));
  const [cgstPerc, setCgstPerc] = useState(percentValue(initialOrder?.cgstPerc ?? prefill?.cgstPerc));
  const [igstPerc, setIgstPerc] = useState(percentValue(initialOrder?.igstPerc ?? prefill?.igstPerc));
  const [description, setDescription] = useState(
    initialOrder?.description ?? (prefill ? `Vendor invoice ${prefill.vendorInvoiceNo}` : ""),
  );
  // Held as the raw File and sent only after the save returns the purchase
  // invoice's id — the same two-phase upload catalogues and products use, so
  // a PDF never travels inside a JSON create request.
  const [pdfFile, setPdfFile] = useState<File | null>(initialPdfFile ?? null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Normally the two states decide which GST heads apply, and the other
  // fields are greyed out so they can't be filled in by accident. Turning
  // this on hands all three back to the admin — for the cases the states
  // can't express, like a bill-to/ship-to split. An edit whose stored heads
  // already contradict the states starts overridden, so re-opening an order
  // never silently rewrites what was deliberately entered.
  const [taxHeadsOverridden, setTaxHeadsOverridden] = useState(() => {
    const orderVendorId = initialOrder?.vendorId ?? prefill?.vendorId;
    if (orderVendorId == null || !ownStateCode) return false;

    const stateCode = resolveStateCode(
      vendors.find((v) => v.id === orderVendorId)?.stateCode,
      vendors.find((v) => v.id === orderVendorId)?.gst,
    );
    if (!stateCode) return false;

    const usesIgst = Boolean(initialOrder?.igstPerc ?? prefill?.igstPerc);
    const usesPair = Boolean(
      (initialOrder?.sgstPerc ?? prefill?.sgstPerc) || (initialOrder?.cgstPerc ?? prefill?.cgstPerc),
    );
    // Nothing recorded at all (a tax-free order) isn't a contradiction.
    if (!usesIgst && !usesPair) return false;
    return isIntraState(stateCode, ownStateCode) ? usesIgst : usesPair;
  });

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit purchase order" : "New purchase order";

  // vendors comes from GET /admin/get_vendors_list, which only returns active
  // vendors, so isDeleted is always false here. Further filtered to
  // GST-registered vendors only — a purchase order needs to be
  // GST-invoiceable, same reasoning as product-form-modal.tsx's identical
  // filter; the backend rejects a non-GST vendor_id too (see
  // _require_vendor_has_gst in routes/orders.py) as defense in depth.
  const vendorOptions: SingleSelectOption[] = vendors
    .filter((vendor) => vendor.gst !== "")
    .map((vendor) => ({
      value: String(vendor.id),
      label: vendor.name,
      isDeleted: false,
    }));

  // A purchase order is placed with a single vendor, so line items can only
  // draw from that vendor's own products — until a vendor is picked, the
  // product picker has nothing to offer and stays disabled (see the <select>
  // below) rather than falling back to every product.
  // Soft-deleted products drop out too, same rule as every other document
  // picker — is_visible isn't consulted, since it only governs the
  // storefront and a purchase order is an internal document.
  const availableProducts = useMemo(
    () => (vendorId ? products.filter((p) => p.vendorId === Number(vendorId) && !p.isDeleted) : []),
    [products, vendorId],
  );
  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);
  const vendorsById = useMemo(() => new Map(vendors.map((v) => [String(v.id), v])), [vendors]);

  // The vendor's state, falling back to their GSTIN's first two digits for
  // vendors saved before the state field existed (same precedence as the
  // backend's resolve_state_code).
  const selectedVendor = vendorId ? vendorsById.get(vendorId) : undefined;
  const vendorStateCode = resolveStateCode(selectedVendor?.stateCode, selectedVendor?.gst);
  // Both sides have to be known before the form is entitled to decide
  // anything; with either missing it leaves all three heads open.
  const taxDirectionKnown = Boolean(vendorStateCode) && Boolean(ownStateCode);
  const intraState = isIntraState(vendorStateCode, ownStateCode);
  const taxHeadsLocked = taxDirectionKnown && !taxHeadsOverridden;
  const vendorHasNoProducts = Boolean(vendorId) && availableProducts.length === 0;

  const totalAmountBeforeTax = lineItems.reduce((sum, item) => sum + item.quantity * (Number(item.rate) || 0), 0);
  const totalTaxPerc = (Number(sgstPerc) || 0) + (Number(cgstPerc) || 0) + (Number(igstPerc) || 0);
  const totalTaxAmount = totalAmountBeforeTax * (totalTaxPerc / 100);
  const totalAmountAfterTax = totalAmountBeforeTax + totalTaxAmount;

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  function handleProductChange(index: number, productId: string) {
    const product = productsById.get(productId);
    updateLineItem(index, { productId, rate: product ? String(product.vendorRate) : "" });
  }

  // Switching vendors invalidates any products already picked for the old
  // one, since the product picker is scoped to a single vendor's catalogue.
  function handleVendorChange(newVendorId: string | null) {
    setVendorId(newVendorId);
    setLineItems((prev) => prev.map((item) => ({ ...item, productId: null, rate: "" })));

    // The rate the admin already chose is kept; only which heads carry it
    // changes, since that's the part the new vendor's state decides. An
    // explicit override is left alone.
    if (taxHeadsOverridden) return;
    const newVendor = newVendorId ? vendorsById.get(newVendorId) : undefined;
    const newStateCode = resolveStateCode(newVendor?.stateCode, newVendor?.gst);
    if (!newStateCode || !ownStateCode) return;

    const heads = taxHeadsFor(isIntraState(newStateCode, ownStateCode), totalTaxPerc);
    setSgstPerc(heads.sgst);
    setCgstPerc(heads.cgst);
    setIgstPerc(heads.igst);
  }

  // Editing one head under a locked direction sets the pair: typing 9 into
  // SGST on an intra-state order fills CGST in to match, and typing a rate
  // into IGST on an inter-state one is the whole rate.
  function handleTaxHeadChange(head: "sgst" | "cgst" | "igst", value: string) {
    if (!taxHeadsLocked) {
      if (head === "sgst") setSgstPerc(value);
      else if (head === "cgst") setCgstPerc(value);
      else setIgstPerc(value);
      return;
    }

    if (head === "igst") {
      setIgstPerc(value);
      return;
    }
    setSgstPerc(value);
    setCgstPerc(value);
  }

  // Leaving override mode re-files whatever rate is showing under the heads
  // the states call for, so the form can't be left in a state its own rules
  // would reject.
  function handleOverrideToggle() {
    const next = !taxHeadsOverridden;
    setTaxHeadsOverridden(next);
    if (next || !taxDirectionKnown) return;

    const heads = taxHeadsFor(intraState, totalTaxPerc);
    setSgstPerc(heads.sgst);
    setCgstPerc(heads.cgst);
    setIgstPerc(heads.igst);
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }

    const sgstPercValue = Number(sgstPerc) || null;
    const cgstPercValue = Number(cgstPerc) || null;
    const igstPercValue = Number(igstPerc) || null;

    // Indian GST: a purchase order is taxed as EITHER SGST+CGST (intra-state)
    // OR IGST alone (inter-state), never both at once — enforced again on
    // the backend (see _check_gst_combo in schemas/purchase_orders.py).
    if ((sgstPercValue || cgstPercValue) && igstPercValue) {
      setError("Use either SGST + CGST or IGST, not both.");
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    // product_ids/quantities/rates are parallel arrays, one entry per line
    // item — the backend re-derives the totals from these rather than
    // trusting totalAmountBeforeTax/AfterTax computed here.
    const productIds = lineItems.map((item) => Number(item.productId));
    const quantities = lineItems.map((item) => item.quantity);
    const rates = lineItems.map((item) => Number(item.rate) || 0);

    const payload = {
      ...(isEdit ? { id: initialOrder?.id } : {}),
      purchase_order_no: purchaseOrderNo,
      vendor_id: Number(vendorId),
      date: fromDatetimeLocalValue(date),
      product_ids: productIds,
      quantities,
      rates,
      sgst_perc: sgstPercValue,
      cgst_perc: cgstPercValue,
      igst_perc: igstPercValue,
      description,
      // Only an uploaded invoice has a vendor invoice number — it's what
      // stops the same document being recorded twice, so it's stored on the
      // purchase invoice this order raises rather than left on the form.
      ...(isEdit || !prefill ? {} : { vendor_invoice_no: prefill.vendorInvoiceNo }),
    };

    try {
      const response = await apiFetch(
        isEdit ? "/admin/update_purchase_order_details" : "/admin/create_new_purchase_order",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        if (response.status === 409) {
          setError("A purchase order with this number already exists.");
        } else {
          // Surface the backend's actual reason (e.g. "vendor not found",
          // "product 12 does not belong to the selected vendor") instead of
          // guessing — a 404 here can mean the order, the vendor, or a
          // product wasn't found, not just the order.
          const detail = await response.json().catch(() => null);
          setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      if (!isEdit && pdfFile) {
        // The order and its purchase invoice already exist at this point, so
        // a failed upload is reported without unwinding them — the PDF can
        // be attached later from the Purchase Invoices tab.
        const { purchase_invoice_id: purchaseInvoiceId } = await response.json();
        try {
          await attachPurchaseInvoicePdf(purchaseInvoiceId, pdfFile);
        } catch {
          setError(
            "Purchase order saved, but its invoice PDF failed to upload. Attach it from the Purchase Invoices tab.",
          );
          setStatus("idle");
          return;
        }
      }

      onSaved();
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) setPdfFile(file);
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-order-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="purchase-order-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {prefill && (
            <div className={styles.parsedInvoiceNotice}>
              <p className={styles.parsedInvoiceTitle}>
                Read from invoice {prefill.vendorInvoiceNo} — {prefill.vendorName}
              </p>
              <p className={styles.pageSubtext}>
                Check every value before saving. Nothing has been recorded yet.
                {prefill.source === "claude" ? " This invoice's layout needed reading by Claude." : ""}
              </p>
              {/* What each line of the invoice was matched to. Shown because
                  a vendor's wording rarely equals our product name, and
                  it's the one thing the form's own fields can't display. */}
              <ul className={styles.parsedInvoiceList}>
                {prefill.lineItems.map((item, index) => (
                  <li key={index}>
                    &ldquo;{item.description}&rdquo; → {item.productName} ({item.quantity} × ₹{item.rate.toFixed(2)},{" "}
                    {item.gstPerc}% GST)
                  </li>
                ))}
              </ul>
              {prefill.totalMismatch && prefill.printedTotal != null && (
                <p role="alert" className={styles.formError}>
                  The invoice&apos;s printed total is ₹{prefill.printedTotal.toFixed(2)}, but these line items add
                  up to ₹{prefill.totalAmountAfterTax.toFixed(2)} — check for a freight, labour or discount line
                  before saving.
                </p>
              )}
            </div>
          )}

          <div className={styles.formGrid}>
            <div>
              <label htmlFor="purchaseOrderNo" className={styles.formLabel}>
                Purchase order no.<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="purchaseOrderNo"
                type="text"
                required
                value={purchaseOrderNo}
                onChange={(e) => setPurchaseOrderNo(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Vendor"
              placeholder="Select a vendor"
              required
              // vendors here always comes from get_vendors_list, which is
              // active-only — the Active/Deleted tabs would just show an
              // always-empty "Deleted" tab, so skip them.
              showStatusFilter={false}
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={handleVendorChange}
            />

            <div>
              <label htmlFor="date" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="date"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            {/* Add mode only: the vendor's own invoice PDF, attached to the
                purchase invoice this order raises. Already set when the form
                was filled from an upload; optional otherwise. Replacing it
                later is done from the Purchase Invoices tab, which is why
                edit mode has no picker of its own. */}
            {!isEdit && (
              <div>
                <span className={styles.formLabel}>Vendor invoice PDF</span>
                <div>
                  <label
                    className={`${styles.triggerButtonBase} ${styles.pdfUploadButton}`}
                    style={{ display: "inline-block", cursor: "pointer" }}
                  >
                    {pdfFile ? "Replace file" : "Choose PDF (optional)"}
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={handlePdfChange}
                      style={{ display: "none" }}
                    />
                  </label>
                  {pdfFile && <p className={styles.pageSubtext}>{pdfFile.name} — uploaded once you save.</p>}
                </div>
              </div>
            )}
          </div>

          <div className={styles.lineItemsSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Line items</span>
              <button type="button" onClick={addLineItem} className={styles.addContactButton}>
                + Add line item
              </button>
            </div>

            <div className={styles.lineItemsHeaderRow}>
              <span className={styles.formLabel}>
                Product<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Quantity<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Rate<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>GST %</span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {lineItems.map((item, index) => {
              // Read-only reference value pulled straight from the selected
              // product's own gst_perc — purely informational alongside this
              // form's order-level SGST/CGST/IGST% combo below, not summed
              // into it.
              const lineGstPerc = productsById.get(item.productId ?? "")?.gstPerc;
              return (
                <div key={index} className={styles.lineItemRow}>
                  <select
                    value={item.productId ?? ""}
                    onChange={(e) => handleProductChange(index, e.target.value)}
                    required
                    disabled={!vendorId || vendorHasNoProducts}
                    aria-label={`Line ${index + 1} product`}
                    className={styles.formInput}
                  >
                    <option value="" disabled>
                      {!vendorId
                        ? "Select a vendor first"
                        : vendorHasNoProducts
                          ? "No products available"
                          : "Select a product…"}
                    </option>
                    {availableProducts.map((product) => (
                      <option key={product.id} value={String(product.id)}>
                        {product.productName}
                      </option>
                    ))}
                  </select>

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
                    disabled
                    value={lineGstPerc != null ? `${lineGstPerc}%` : "—"}
                    aria-label={`Line ${index + 1} product GST percent`}
                    className={styles.formInput}
                  />

                  <input
                    type="text"
                    disabled
                    value={`₹${(item.quantity * (Number(item.rate) || 0)).toFixed(2)}`}
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

          <div className={styles.totalsGrid}>
            <div>
              <label htmlFor="sgstPerc" className={styles.formLabel}>
                SGST %<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="sgstPerc"
                value={sgstPerc}
                onChange={(e) => handleTaxHeadChange("sgst", e.target.value)}
                disabled={taxHeadsLocked && !intraState}
                className={styles.formInput}
              >
                <option value="">—</option>
                {/* Hardcoded placeholder slabs — see lib/gst.ts */}
                {percentOptions(sgstPerc, taxHeadsLocked && intraState).map((percent) => (
                  <option key={percent} value={percent}>
                    {percent}%
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cgstPerc" className={styles.formLabel}>
                CGST %<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="cgstPerc"
                value={cgstPerc}
                onChange={(e) => handleTaxHeadChange("cgst", e.target.value)}
                disabled={taxHeadsLocked && !intraState}
                className={styles.formInput}
              >
                <option value="">—</option>
                {percentOptions(cgstPerc, taxHeadsLocked && intraState).map((percent) => (
                  <option key={percent} value={percent}>
                    {percent}%
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="igstPerc" className={styles.formLabel}>
                IGST %<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="igstPerc"
                value={igstPerc}
                onChange={(e) => handleTaxHeadChange("igst", e.target.value)}
                disabled={taxHeadsLocked && intraState}
                className={styles.formInput}
              >
                <option value="">—</option>
                {percentOptions(igstPerc).map((percent) => (
                  <option key={percent} value={percent}>
                    {percent}%
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Says which heads apply and why, so a greyed-out IGST box reads
              as a decision the form made rather than a broken field. */}
          {taxDirectionKnown && (
            <p className={styles.formHint}>
              {intraState
                ? `Vendor is in ${stateNameForCode(vendorStateCode)}, the same state as us — SGST + CGST.`
                : `Vendor is in ${stateNameForCode(vendorStateCode)}, we're in ${stateNameForCode(ownStateCode)} — IGST.`}{" "}
              <button type="button" onClick={handleOverrideToggle} className={styles.linkButton}>
                {taxHeadsOverridden ? "Use the vendor's state" : "Set the heads manually"}
              </button>
            </p>
          )}

          {(Number(sgstPerc) || Number(cgstPerc)) > 0 && Number(igstPerc) > 0 && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              Use either SGST + CGST or IGST, not both.
            </p>
          )}

          <div>
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

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total before tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountBeforeTax.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total tax ({totalTaxPerc}%)</p>
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
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={status === "saving"}>
                {status === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
