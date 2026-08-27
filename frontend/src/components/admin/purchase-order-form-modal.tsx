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
// Line items are submitted as parallel product_ids/quantities/rates/gst_percs
// arrays (see CreateNewPurchaseOrderRequest in
// backend/app/schemas/purchase_orders.py), each persisted as its own
// #purchase_summary row tied back to the new purchase order via
// purchase_order_id.
//
// GST is entered per line, not once for the order: a vendor invoice routinely
// taxes its lines at different rates (5% paper board billed alongside 18%
// toiletries), which one order-level rate could only have represented by
// averaging. What the order still decides is which HEADS carry those rates —
// CGST + SGST for an intra-state purchase, IGST for an inter-state one —
// since that follows from the two parties' states rather than from the goods.
// The heads panel below the line items shows what that works out to and lets
// the admin override the direction; there is nowhere left to type a rate
// twice.
//
// In "add" mode the form can arrive pre-filled from a vendor's own invoice
// PDF (the `prefill` prop, read by components/admin/
// purchase-invoice-upload-modal.tsx) — every field stays editable, since the
// point of that path is that the admin reviews what was read before it
// saves. A line the backend couldn't place against one of the vendor's
// products arrives unresolved (productId null): the review notice says so and
// offers to create that product from the invoice itself (see
// CreateMissingProduct at the bottom of this file), and the row's own product
// <select> — already `required` — is what stops the order being saved until
// every line has one. Either way, saving also raises the order's purchase invoice
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
import type { ParsedInvoiceLineItem, ParsedPurchaseInvoice, PurchaseOrder, TaxKind } from "@/lib/purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import { createProduct, type Product } from "@/lib/products";
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
  // This line's GST rate, as the <select> holds it ("" for none). The whole
  // rate, not a half: splitting it across CGST and SGST is what the heads
  // do with it, and only on an intra-state purchase.
  gstPerc: string;
  // Which of the uploaded invoice's lines this row was built from, for rows
  // that came from a PDF. Kept so that creating the missing product from the
  // review notice can find this row again — a bare index into
  // prefill.lineItems would drift as soon as any row is added or removed.
  sourceLineIndex?: number;
};

function emptyLineItem(): LineItem {
  return { productId: null, quantity: 1, rate: "", gstPerc: "" };
}

// Reassembles an existing order's parallel productIds/quantities/rates/
// gstPercs arrays (see lib/purchase-orders.ts) back into per-line-item rows
// for the form's local state.
function lineItemsFromOrder(order: PurchaseOrder): LineItem[] {
  if (order.productIds.length === 0) return [emptyLineItem()];
  return order.productIds.map((productId, index) => ({
    productId: String(productId),
    quantity: order.quantities[index] ?? 1,
    rate: String(order.rates[index] ?? ""),
    gstPerc: percentValue(order.gstPercs[index]),
  }));
}

function lineItemsFromParsedInvoice(parsed: ParsedPurchaseInvoice): LineItem[] {
  if (parsed.lineItems.length === 0) return [emptyLineItem()];
  return parsed.lineItems.map((item, index) => ({
    // Null for a line whose product the backend couldn't place: the row's
    // <select> falls back to its "Select a product…" placeholder, and being
    // `required` it blocks the save until the admin resolves it.
    productId: item.productId != null ? String(item.productId) : null,
    quantity: item.quantity,
    rate: String(item.rate),
    // The rate this line was actually billed at, which on a mixed invoice is
    // not the rate any other line was billed at.
    gstPerc: percentValue(item.gstPerc),
    sourceLineIndex: index,
  }));
}

// What a product created from an invoice line is priced at, as multiples of
// what the vendor charged. A purchase invoice records the cost and nothing
// about the selling price, but add_product_details requires both (and
// requires the discounted one to be below the actual one — see
// AddProductDetailsRequest), so they're derived rather than left out.
// Deliberately a starting point to correct on /admin/products, which is why
// such a product is created hidden from the storefront.
const ACTUAL_PRICE_MULTIPLIER = 2;
const DISCOUNTED_PRICE_MULTIPLIER = 1.5;

function sellingPricesFromCost(vendorRate: number): { actualPrice: number; discountedPrice: number } {
  const round = (value: number) => Math.round(value * 100) / 100;
  const actualPrice = round(vendorRate * ACTUAL_PRICE_MULTIPLIER);
  const derived = round(vendorRate * DISCOUNTED_PRICE_MULTIPLIER);
  return {
    actualPrice,
    // The multipliers keep these apart at any real rate; rounding to paise
    // only collapses them for sub-paisa ones, where halving keeps the create
    // valid rather than letting the backend reject it.
    discountedPrice: derived < actualPrice ? derived : round(actualPrice / 2),
  };
}

// The GST % dropdowns hold their value as text ("" for none), since that's
// what a <select> reads and writes.
function percentValue(percent: number | null | undefined): string {
  return percent != null ? String(percent) : "";
}

// GST_PERCENT_OPTIONS lists the standard slabs; a parsed invoice can carry a
// rate that isn't one of them at all. Folding the current value in keeps the
// dropdown able to show what's actually selected instead of silently falling
// back to "—". Always the full rate: halving it across CGST and SGST is what
// the heads do with it, not something the line is entered as.
function percentOptions(selected: string): number[] {
  const value = Number(selected);
  if (!selected || !Number.isFinite(value) || GST_PERCENT_OPTIONS.includes(value)) {
    return GST_PERCENT_OPTIONS;
  }
  return [...GST_PERCENT_OPTIONS, value].sort((a, b) => a - b);
}

// How the line items' rates read once filed under the given heads: intra-state
// splits each rate in half across CGST and SGST, inter-state puts all of it on
// IGST. Mirrors split_tax in backend/app/services/gst.py.
//
// Plural because the lines needn't agree — a mixed invoice genuinely is
// "IGST 5% + 18%", and saying so is the point of showing this at all.
function taxHeadSummary(taxKind: TaxKind, percs: number[]): string {
  const rates = [...new Set(percs.filter((percent) => percent > 0))].sort((a, b) => a - b);
  if (rates.length === 0) return "No GST on this order.";

  const listed = (halved: boolean) =>
    rates.map((rate) => `${halved ? rate / 2 : rate}%`).join(" + ");
  return taxKind === "cgst_sgst"
    ? `CGST ${listed(true)} + SGST ${listed(true)}`
    : `IGST ${listed(false)}`;
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
  onProductCreated,
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
  // A product created from an unresolved invoice line. The parent owns the
  // `products` list this form picks from, so it has to hear about the new one
  // — otherwise the line it was created for couldn't select it.
  onProductCreated?: (product: Product) => void;
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
  const [description, setDescription] = useState(
    initialOrder?.description ?? (prefill ? `Vendor invoice ${prefill.vendorInvoiceNo}` : ""),
  );
  // Held as the raw File and sent only after the save returns the purchase
  // invoice's id — the same two-phase upload catalogues and products use, so
  // a PDF never travels inside a JSON create request.
  const [pdfFile, setPdfFile] = useState<File | null>(initialPdfFile ?? null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // Index into prefill.lineItems of the unresolved line whose "create the
  // missing product" form is open, or null when none is.
  const [creatingForLine, setCreatingForLine] = useState<number | null>(null);

  // Normally the two states decide which GST heads apply. This holds a
  // deliberate departure from that — for the cases the states can't express,
  // like a bill-to/ship-to split — and null the rest of the time, so that
  // changing the vendor re-decides the heads on its own.
  //
  // An order whose stored heads already contradict the states starts
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
  // What the two states call for, and then what this order is actually filed
  // under. They differ only where the admin has deliberately overridden it.
  const taxKindFromStates: TaxKind = intraState ? "cgst_sgst" : "igst";
  const taxKind: TaxKind = taxKindOverride ?? taxKindFromStates;
  const taxHeadsOverridden = taxKindOverride != null;
  const vendorHasNoProducts = Boolean(vendorId) && availableProducts.length === 0;

  const lineGstPercs = lineItems.map((item) => Number(item.gstPerc) || 0);
  const totalAmountBeforeTax = lineItems.reduce((sum, item) => sum + item.quantity * (Number(item.rate) || 0), 0);
  // Taxed line by line at each line's own rate, the same sum _compute_totals
  // in backend/app/api/routes/orders.py does on what this form submits — so
  // the figure shown here is the figure that gets saved.
  const totalTaxAmount = lineItems.reduce(
    (sum, item, index) => sum + item.quantity * (Number(item.rate) || 0) * (lineGstPercs[index] / 100),
    0,
  );
  const totalAmountAfterTax = totalAmountBeforeTax + totalTaxAmount;

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  // Picking a product fills in both of the things we already know about it:
  // what this vendor charges for it, and what it's taxed at. Either can be
  // overridden — an invoice is what was actually billed, not what our
  // catalogue expected.
  function handleProductChange(index: number, productId: string) {
    const product = productsById.get(productId);
    updateLineItem(index, {
      productId,
      rate: product ? String(product.vendorRate) : "",
      gstPerc: product ? percentValue(product.gstPerc) : "",
    });
  }

  // Switching vendors invalidates any products already picked for the old
  // one, since the product picker is scoped to a single vendor's catalogue —
  // and with them the rates, which were that vendor's.
  //
  // The heads need no adjusting: they follow the new vendor's state through
  // taxKindFromStates on the next render, unless the admin has overridden
  // them, in which case the override is left alone.
  function handleVendorChange(newVendorId: string | null) {
    setVendorId(newVendorId);
    setLineItems((prev) => prev.map((item) => ({ ...item, productId: null, rate: "", gstPerc: "" })));
  }

  // Toggles between the heads the two states call for and the other pair.
  // There are only ever two, so "override" is a single choice rather than
  // three fields handed back to the admin.
  function handleOverrideToggle() {
    setTaxKindOverride(taxHeadsOverridden ? null : taxKindFromStates === "igst" ? "cgst_sgst" : "igst");
  }

  // The product the admin just created for an unresolved invoice line. Its
  // row is selected straight away rather than left for them to find in a
  // dropdown that has only this second grown the option. The line keeps the
  // rate the invoice printed: that's what was actually charged, whatever
  // vendor_rate the new product was given.
  function handleProductCreated(sourceLineIndex: number, product: Product) {
    onProductCreated?.(product);
    setLineItems((prev) =>
      prev.map((item) =>
        item.sourceLineIndex === sourceLineIndex ? { ...item, productId: String(product.id) } : item,
      ),
    );
    setCreatingForLine(null);
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

    // product_ids/quantities/rates/gst_percs are parallel arrays, one entry
    // per line item — the backend re-derives the totals from these rather
    // than trusting totalAmountBeforeTax/AfterTax computed here.
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
      gst_percs: lineGstPercs,
      // Which heads carry those rates. Sent instead of the three percentage
      // fields, which the backend now derives from these two: on a mixed-rate
      // order there is no single percentage to send, so they could no longer
      // be what says whether this purchase is intra- or inter-state.
      tax_kind: taxKind,
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
                    &ldquo;{item.description}&rdquo; →{" "}
                    {item.productId != null ? (
                      item.productName
                    ) : (
                      <span className={styles.parsedInvoiceUnmatched}>no product yet</span>
                    )}{" "}
                    ({item.quantity} × ₹{item.rate.toFixed(2)}, {item.gstPerc}% GST)
                    {item.productId == null && (
                      <>
                        <br />
                        {/* Not a failure — the values were all read fine.
                            The line just needs a product before it can move
                            any stock, which is either one we already have
                            under a different name or one we've never
                            bought. */}
                        {item.unresolvedReason}. Pick it in the row below, or{" "}
                        <button
                          type="button"
                          onClick={() => setCreatingForLine(creatingForLine === index ? null : index)}
                          className={styles.linkButton}
                        >
                          {creatingForLine === index ? "cancel" : "add it from this invoice"}
                        </button>
                        .
                        {creatingForLine === index && vendorId && (
                          <CreateMissingProduct
                            line={item}
                            vendorId={Number(vendorId)}
                            onCreated={(product) => handleProductCreated(index, product)}
                          />
                        )}
                      </>
                    )}
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
              <span className={styles.formLabel}>
                GST %<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {lineItems.map((item, index) => {
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

                  {/* The rate this line is taxed at, and the only place a
                      rate is entered. Pre-filled from the product's own
                      gst_perc, or from the invoice on an upload, but always
                      editable: what the vendor billed wins over what our
                      catalogue expected. */}
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
              );
            })}
          </div>

          {/* The heads the line items' rates are filed under. Derived rather
              than entered: the rates come from the rows above, and which
              heads carry them follows from the two parties' states, so there
              is nothing here to type — only a direction to correct where the
              states get it wrong. */}
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

          {/* Says which heads apply and why, so the read-only box above reads
              as a decision the form made rather than a missing field. */}
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
              {/* No single percentage where the lines disagree, so the heads
                  summary stands in for one — "IGST 5% + 18%" rather than a
                  blended figure that matches no line on the invoice. */}
              <p className={styles.totalsRowLabel}>Total tax ({taxHeadSummary(taxKind, lineGstPercs)})</p>
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


// ---------------------------------------------------------------------------
// <CreateMissingProduct> — adding the product an invoice line needs, from the
// invoice itself
// ---------------------------------------------------------------------------
// Opened from the review notice above for a line whose description didn't
// resolve to one of the vendor's products. Nothing is typed here: everything
// the product needs is either printed on the invoice or derived from it, and
// the panel exists purely so the admin sees exactly what is about to be
// created before it is. Confirming writes the product immediately (not when
// the order saves) and points the line at it.
//
// The one thing an invoice fundamentally cannot supply is what we SELL the
// thing for — a vendor's bill records what we paid. Those two prices are
// derived from the cost by the multipliers below, which is a starting point
// to correct on /admin/products, not a considered price. That's also why the
// product is created hidden: priced by rule of thumb, with no images and no
// categories, it has no business on the storefront until someone has been
// over it.
function CreateMissingProduct({
  line,
  vendorId,
  onCreated,
}: {
  line: ParsedInvoiceLineItem;
  // The invoice's own vendor — a product created from this line belongs to
  // them by construction, so it isn't offered as a choice.
  vendorId: number;
  onCreated: (product: Product) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const { actualPrice, discountedPrice } = sellingPricesFromCost(line.rate);

  async function handleCreate() {
    setStatus("saving");
    setError(null);

    try {
      const product = await createProduct({
        // The vendor's own wording for it, which is all we know it by. Also
        // kept as the description, so there's a record of what this product
        // was bought as.
        productName: line.description,
        hsnCode: line.hsnCode,
        vendorId,
        vendorRate: line.rate,
        actualPrice,
        discountedPrice,
        gstPerc: line.gstPerc,
        moq: 1,
        description: line.description,
        isVisible: false,
      });
      onCreated(product);
    } catch (createError) {
      setError(
        createError instanceof Error && createError.message
          ? createError.message
          : "Couldn't create this product. Please try again.",
      );
      setStatus("idle");
    }
  }

  return (
    <div className={styles.newProductPanel}>
      <dl className={styles.newProductSummary}>
        <div>
          <dt>Name</dt>
          <dd>{line.description}</dd>
        </div>
        <div>
          <dt>HSN code</dt>
          <dd>{line.hsnCode || "—"}</dd>
        </div>
        <div>
          <dt>Vendor rate</dt>
          <dd>₹{line.rate.toFixed(2)}</dd>
        </div>
        <div>
          <dt>GST</dt>
          <dd>{line.gstPerc}%</dd>
        </div>
        <div>
          <dt>Actual price</dt>
          <dd>
            ₹{actualPrice.toFixed(2)} <span className={styles.newProductDerived}>{ACTUAL_PRICE_MULTIPLIER}× cost</span>
          </dd>
        </div>
        <div>
          <dt>Discounted price</dt>
          <dd>
            ₹{discountedPrice.toFixed(2)}{" "}
            <span className={styles.newProductDerived}>{DISCOUNTED_PRICE_MULTIPLIER}× cost</span>
          </dd>
        </div>
        <div>
          <dt>MOQ</dt>
          <dd>1</dd>
        </div>
        <div>
          <dt>Storefront</dt>
          <dd>Hidden</dd>
        </div>
      </dl>

      <p className={styles.newProductHint}>
        The prices are worked out from what this invoice charged — set the real ones, and add categories and
        images, on Products afterwards. Creating it saves the product straight away, before this order.
      </p>

      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      <div className={styles.newProductActions}>
        <Button type="button" variant="secondary" onClick={handleCreate} disabled={status === "saving"}>
          {status === "saving" ? "Creating…" : "Create product"}
        </Button>
      </div>
    </div>
  );
}
