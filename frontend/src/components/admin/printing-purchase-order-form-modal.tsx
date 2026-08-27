"use client";

// ---------------------------------------------------------------------------
// <PrintingPurchaseOrderFormModal> — add/edit popup for the Printing view of
// the Purchase orders tab on /admin/orders
// ---------------------------------------------------------------------------
// The printing counterpart of components/admin/purchase-order-form-modal.tsx:
//   - mode "add"  -> POST /admin/create_new_printing_purchase_order
//   - mode "edit" -> POST /admin/update_printing_purchase_order_details
// Both live in backend/app/api/routes/printing_orders.py.
//
// It is a markedly simpler form than the material one, and every difference
// comes from the same fact: a printing line item is a DESCRIPTION, not a
// product. So there is no product picker, no vendor-scoped catalogue to
// filter, no rate auto-filled from a product master, and no "create the
// missing product" panel — because a printing service was never in the
// catalogue and creating a product for it would be wrong. Nothing this form
// saves moves stock.
//
// The vendor picker offers PRINTING vendors only. The backend enforces the
// same rule (see _get_printing_vendor_or_400) as defence in depth, since a
// material vendor's order landing in this collection would be a purchase
// that silently never reached #inventory.
//
// GST works exactly as it does on the material side: the rate is entered per
// line, and the form derives only which HEADS carry it from the two parties'
// states, with a manual override for the cases the states can't express.
//
// In "add" mode the form can arrive pre-filled from the vendor's own invoice
// PDF (the `prefill` prop, from printing-purchase-invoice-upload-modal.tsx).
// Every field stays editable — the point of that path is that the admin
// reviews what was read before it saves. Saving also raises the order's
// printing purchase invoice server-side, and the vendor PDF is attached to
// that invoice in a follow-up request once it has an id.
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import { GST_PERCENT_OPTIONS, isIntraState, resolveStateCode, stateNameForCode } from "@/lib/gst";
import { attachPrintingPurchaseInvoicePdf } from "@/lib/printing-purchase-invoices";
import type {
  ParsedPrintingPurchaseInvoice,
  PrintingPurchaseOrder,
} from "@/lib/printing-purchase-orders";
import type { TaxKind } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

type LineItem = {
  // The service as the vendor billed it. This IS the line item — there is
  // nothing behind it to look up, so it's required and free text.
  description: string;
  // The SAC/HSN the vendor printed against it. Optional: printing bills use
  // both kinds of code (998912 for a print service, 3919 for printed
  // stickers billed as goods) and plenty print neither.
  hsnCode: string;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput (see lib/decimal-input.ts)
  // rather than a controlled type="number" input, so a leading "0" can just
  // be typed over instead of leaving stray zeros until blur.
  rate: string;
  // This line's GST rate, as the <select> holds it ("" for none). The whole
  // rate, not a half: splitting it across CGST and SGST is what the heads do
  // with it, and only on an intra-state purchase.
  gstPerc: string;
};

function emptyLineItem(): LineItem {
  return { description: "", hsnCode: "", quantity: 1, rate: "", gstPerc: "" };
}

// Reassembles an existing order's parallel arrays (see
// lib/printing-purchase-orders.ts) back into per-line-item rows for the
// form's local state.
function lineItemsFromOrder(order: PrintingPurchaseOrder): LineItem[] {
  if (order.descriptions.length === 0) return [emptyLineItem()];
  return order.descriptions.map((description, index) => ({
    description,
    hsnCode: order.hsnCodes[index] ?? "",
    quantity: order.quantities[index] ?? 1,
    rate: String(order.rates[index] ?? ""),
    gstPerc: percentValue(order.gstPercs[index]),
  }));
}

function lineItemsFromParsedInvoice(parsed: ParsedPrintingPurchaseInvoice): LineItem[] {
  if (parsed.lineItems.length === 0) return [emptyLineItem()];
  return parsed.lineItems.map((item) => ({
    description: item.description,
    hsnCode: item.hsnCode,
    quantity: item.quantity,
    rate: String(item.rate),
    // The rate this line was actually billed at, which on a mixed invoice is
    // not the rate any other line was billed at.
    gstPerc: percentValue(item.gstPerc),
  }));
}

// The GST % dropdowns hold their value as text ("" for none), since that's
// what a <select> reads and writes.
function percentValue(percent: number | null | undefined): string {
  return percent != null ? String(percent) : "";
}

// GST_PERCENT_OPTIONS lists the standard slabs; a parsed invoice can carry a
// rate that isn't one of them. Folding the current value in keeps the
// dropdown able to show what's actually selected instead of silently falling
// back to "—".
function percentOptions(selected: string): number[] {
  const value = Number(selected);
  if (!selected || !Number.isFinite(value) || GST_PERCENT_OPTIONS.includes(value)) {
    return GST_PERCENT_OPTIONS;
  }
  return [...GST_PERCENT_OPTIONS, value].sort((a, b) => a - b);
}

// How the line items' rates read once filed under the given heads. Mirrors
// split_tax in backend/app/services/gst.py, and plural because the lines
// needn't agree — a mixed bill genuinely is "IGST 5% + 18%".
function taxHeadSummary(taxKind: TaxKind, percs: number[]): string {
  const rates = [...new Set(percs.filter((percent) => percent > 0))].sort((a, b) => a - b);
  if (rates.length === 0) return "No GST on this order.";

  const listed = (halved: boolean) => rates.map((rate) => `${halved ? rate / 2 : rate}%`).join(" + ");
  return taxKind === "cgst_sgst"
    ? `CGST ${listed(true)} + SGST ${listed(true)}`
    : `IGST ${listed(false)}`;
}

export function PrintingPurchaseOrderFormModal({
  mode,
  initialOrder,
  prefill,
  initialPdfFile,
  vendors,
  ownStateCode,
  nextPurchaseOrderNo,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialOrder?: PrintingPurchaseOrder;
  // "add" mode only: values read off a vendor's invoice PDF, for review.
  prefill?: ParsedPrintingPurchaseInvoice;
  // The vendor's PDF, either the one that was parsed into `prefill` or one
  // picked here. Attached to the printing purchase invoice this order
  // raises, once the save returns its id.
  initialPdfFile?: File | null;
  vendors: VendorOption[];
  // Our own GST state code, from the company profile. Compared against the
  // chosen vendor's state to decide SGST + CGST vs IGST. "" if the profile
  // has no state on file, in which case the form stops guessing.
  ownStateCode: string;
  nextPurchaseOrderNo: string;
  onClose: () => void;
  // No order payload — the backend only returns {message, invoice id}, so
  // the parent re-fetches the authoritative list rather than reconstructing
  // one client-side.
  onSaved: () => void;
}) {
  const [vendorId, setVendorId] = useState<string | null>(
    initialOrder ? String(initialOrder.vendorId) : prefill ? String(prefill.vendorId) : null,
  );
  // An uploaded invoice's own number becomes the purchase order number, so
  // the order and the vendor's document are findable by the same string.
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
  const [description, setDescription] = useState(
    initialOrder?.description ?? (prefill ? `Vendor invoice ${prefill.vendorInvoiceNo}` : ""),
  );
  // Held as the raw File and sent only after the save returns the printing
  // purchase invoice's id — the same two-phase upload the rest of the app
  // uses, so a PDF never travels inside a JSON create request.
  const [pdfFile, setPdfFile] = useState<File | null>(initialPdfFile ?? null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // A deliberate departure from what the two states call for — for the cases
  // they can't express, like a bill-to/ship-to split — and null the rest of
  // the time, so changing the vendor re-decides the heads on its own. An
  // order whose stored heads already contradict the states starts
  // overridden, so re-opening one never silently rewrites what was entered.
  const [taxKindOverride, setTaxKindOverride] = useState<TaxKind | null>(() => {
    const orderVendorId = initialOrder?.vendorId ?? prefill?.vendorId;
    const storedKind = initialOrder?.taxKind ?? prefill?.taxKind ?? null;
    if (orderVendorId == null || !ownStateCode || storedKind == null) return null;

    const vendor = vendors.find((v) => v.id === orderVendorId);
    const stateCode = resolveStateCode(vendor?.stateCode, vendor?.gst);
    if (!stateCode) return null;

    const kindFromStates: TaxKind = isIntraState(stateCode, ownStateCode) ? "cgst_sgst" : "igst";
    return storedKind === kindFromStates ? null : storedKind;
  });

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit printing purchase order" : "New printing purchase order";

  // Printing vendors only, and GST-registered ones only — a purchase order
  // has to be GST-invoiceable, and this collection is what says a purchase
  // bought a service rather than stock. The backend rejects a vendor failing
  // either rule too (see _get_printing_vendor_or_400).
  const vendorOptions: SingleSelectOption[] = vendors
    .filter((vendor) => vendor.gst !== "" && vendor.vendorType === "printing")
    .map((vendor) => ({ value: String(vendor.id), label: vendor.name, isDeleted: false }));

  const vendorsById = useMemo(() => new Map(vendors.map((v) => [String(v.id), v])), [vendors]);

  // The vendor's state, falling back to their GSTIN's first two digits for
  // vendors saved before the state field existed (same precedence as the
  // backend's resolve_state_code).
  const selectedVendor = vendorId ? vendorsById.get(vendorId) : undefined;
  const vendorStateCode = resolveStateCode(selectedVendor?.stateCode, selectedVendor?.gst);
  // Both sides have to be known before the form is entitled to decide
  // anything; with either missing it leaves the heads alone.
  const taxDirectionKnown = Boolean(vendorStateCode) && Boolean(ownStateCode);
  const intraState = isIntraState(vendorStateCode, ownStateCode);
  const taxKindFromStates: TaxKind = intraState ? "cgst_sgst" : "igst";
  const taxKind: TaxKind = taxKindOverride ?? taxKindFromStates;
  const taxHeadsOverridden = taxKindOverride != null;

  const lineGstPercs = lineItems.map((item) => Number(item.gstPerc) || 0);
  const totalAmountBeforeTax = lineItems.reduce((sum, item) => sum + item.quantity * (Number(item.rate) || 0), 0);
  // Taxed line by line at each line's own rate, the same sum _compute_totals
  // in backend/app/api/routes/printing_orders.py does on what this form
  // submits — so the figure shown here is the figure that gets saved.
  const totalTaxAmount = lineItems.reduce(
    (sum, item, index) => sum + item.quantity * (Number(item.rate) || 0) * (lineGstPercs[index] / 100),
    0,
  );
  const totalAmountAfterTax = totalAmountBeforeTax + totalTaxAmount;

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  // Nothing about a line item belongs to the vendor here — the descriptions
  // are the admin's or the invoice's, not a catalogue's — so switching
  // vendors leaves the rows alone, unlike the material form which has to
  // clear every product. The heads follow the new vendor's state on the next
  // render unless they've been overridden.
  function handleVendorChange(newVendorId: string | null) {
    setVendorId(newVendorId);
  }

  // Toggles between the heads the two states call for and the other pair.
  // There are only ever two, so "override" is a single choice rather than
  // three fields handed back to the admin.
  function handleOverrideToggle() {
    setTaxKindOverride(taxHeadsOverridden ? null : taxKindFromStates === "igst" ? "cgst_sgst" : "igst");
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

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    // Parallel arrays, one entry per line item — the backend re-derives the
    // totals from these rather than trusting the ones computed above.
    const payload = {
      ...(isEdit ? { id: initialOrder?.id } : {}),
      purchase_order_no: purchaseOrderNo,
      vendor_id: Number(vendorId),
      date: fromDatetimeLocalValue(date),
      descriptions: lineItems.map((item) => item.description),
      hsn_codes: lineItems.map((item) => item.hsnCode),
      quantities: lineItems.map((item) => item.quantity),
      rates: lineItems.map((item) => Number(item.rate) || 0),
      gst_percs: lineGstPercs,
      // Which heads carry those rates. Sent instead of the three percentage
      // fields, which the backend derives: a mixed-rate order has no single
      // percentage that could have said which way this purchase runs.
      tax_kind: taxKind,
      description,
      // Only an uploaded invoice has a vendor invoice number — it's what
      // stops the same document being recorded twice, so it's stored on the
      // printing purchase invoice this order raises.
      ...(isEdit || !prefill ? {} : { vendor_invoice_no: prefill.vendorInvoiceNo }),
    };

    try {
      const response = await apiFetch(
        isEdit
          ? "/admin/update_printing_purchase_order_details"
          : "/admin/create_new_printing_purchase_order",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        // Surface the backend's own reason — a 400 here can mean the vendor
        // isn't a printing vendor or has no GSTIN, and a 409 can mean either
        // the order number or the vendor's invoice is already recorded.
        const detail = await response.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      if (!isEdit && pdfFile) {
        // The order and its invoice already exist at this point, so a failed
        // upload is reported without unwinding them — the PDF can be
        // attached later from the Purchase Invoices tab.
        const { printing_purchase_invoice_id: invoiceId } = await response.json();
        try {
          await attachPrintingPurchaseInvoicePdf(invoiceId, pdfFile);
        } catch {
          setError(
            "Printing purchase order saved, but its invoice PDF failed to upload. Attach it from the Purchase Invoices tab.",
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
        aria-labelledby="printing-purchase-order-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="printing-purchase-order-modal-title" className={styles.modalTitle}>
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
              {/* Every line is shown as it was read. Unlike the material
                  form there is nothing here to resolve — the description IS
                  the line item — so this is a transcript to check against
                  the PDF, not a list of questions. A vendor who prints a
                  second line under the service name (Pearl Creation's
                  "Christ Logo Laptop Bag" under "Customized Print Service")
                  loses it here, which is exactly the kind of thing to
                  correct in the rows below before saving. */}
              <ul className={styles.parsedInvoiceList}>
                {prefill.lineItems.map((item, index) => (
                  <li key={index}>
                    &ldquo;{item.description}&rdquo; ({item.quantity} × ₹{item.rate.toFixed(2)}, {item.gstPerc}%
                    GST{item.hsnCode ? `, HSN/SAC ${item.hsnCode}` : ""})
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
              <label htmlFor="printingPurchaseOrderNo" className={styles.formLabel}>
                Purchase order no.<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="printingPurchaseOrderNo"
                type="text"
                required
                value={purchaseOrderNo}
                onChange={(e) => setPurchaseOrderNo(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Printing vendor"
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
              <label htmlFor="printingPurchaseOrderDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="printingPurchaseOrderDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            {/* Add mode only: the vendor's own invoice PDF, attached to the
                printing purchase invoice this order raises. Already set when
                the form was filled from an upload; optional otherwise.
                Replacing it later is done from the Purchase Invoices tab,
                which is why edit mode has no picker of its own. */}
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

            <div className={styles.printingLineItemsHeaderRow}>
              <span className={styles.formLabel}>
                Service<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>HSN/SAC</span>
              <span className={styles.formLabel}>
                Quantity<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Rate<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                GST %<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {lineItems.map((item, index) => (
              <div key={index} className={styles.printingLineItemRow}>
                {/* Typed, not picked. There is no catalogue behind a
                    printing service, so what the vendor called it is the
                    only name it has. */}
                <input
                  type="text"
                  required
                  value={item.description}
                  onChange={(e) => updateLineItem(index, { description: e.target.value })}
                  placeholder="e.g. Customized Print Service"
                  aria-label={`Line ${index + 1} service`}
                  className={styles.formInput}
                />

                <input
                  type="text"
                  value={item.hsnCode}
                  onChange={(e) => updateLineItem(index, { hsnCode: e.target.value })}
                  placeholder="Optional"
                  aria-label={`Line ${index + 1} HSN or SAC code`}
                  className={styles.formInput}
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

                <select
                  value={item.gstPerc}
                  onChange={(e) => updateLineItem(index, { gstPerc: e.target.value })}
                  required
                  aria-label={`Line ${index + 1} GST percent`}
                  className={styles.formInput}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {/* Hardcoded placeholder slabs — see lib/gst.ts */}
                  {percentOptions(item.gstPerc).map((percent) => (
                    <option key={percent} value={percent}>
                      {percent}%
                    </option>
                  ))}
                </select>

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
            ))}
          </div>

          {/* The heads the line items' rates are filed under. Derived rather
              than entered: the rates come from the rows above, and which
              heads carry them follows from the two parties' states. */}
          <div>
            <span className={styles.formLabel}>GST heads</span>
            <input
              type="text"
              disabled
              value={taxHeadSummary(taxKind, lineGstPercs)}
              aria-label="GST heads"
              className={styles.formInput}
            />
          </div>

          {taxDirectionKnown && (
            <p className={styles.formHint}>
              {taxHeadsOverridden
                ? `Set manually to ${taxKind === "cgst_sgst" ? "CGST + SGST" : "IGST"}, against what the states call for.`
                : intraState
                  ? `Vendor is in ${stateNameForCode(vendorStateCode)}, the same state as us — SGST + CGST.`
                  : `Vendor is in ${stateNameForCode(vendorStateCode)}, we're in ${stateNameForCode(ownStateCode)} — IGST.`}{" "}
              <button type="button" onClick={handleOverrideToggle} className={styles.linkButton}>
                {taxHeadsOverridden
                  ? "Use the vendor's state"
                  : `Use ${taxKindFromStates === "igst" ? "CGST + SGST" : "IGST"} instead`}
              </button>
            </p>
          )}

          <div>
            <label htmlFor="printingPurchaseOrderDescription" className={styles.formLabel}>
              Description<span className={styles.requiredMark}>*</span>
            </label>
            <textarea
              id="printingPurchaseOrderDescription"
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
              <p className={styles.totalsRowLabel}>Total tax ({taxHeadSummary(taxKind, lineGstPercs)})</p>
              <p className={styles.totalsRowValue}>₹{totalTaxAmount.toFixed(2)}</p>
            </div>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total after tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountAfterTax.toFixed(2)}</p>
            </div>
          </div>

          {/* Says plainly what this order does NOT do, because the material
              form next door does the opposite and the two look alike. */}
          <p className={styles.formHint}>
            Printing purchases don&apos;t affect products or inventory — nothing here adds stock.
          </p>

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
