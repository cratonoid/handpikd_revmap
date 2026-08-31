"use client";

// ---------------------------------------------------------------------------
// <UnbilledPurchaseOrderFormModal> — add/edit popup for the Unbilled section
// of the Purchase orders tab on /admin/orders
// ---------------------------------------------------------------------------
//   - mode "add"  -> POST /admin/create_new_unbilled_purchase_order
//   - mode "edit" -> POST /admin/update_unbilled_purchase_order_details
// Both live in backend/app/api/routes/unbilled_orders.py.
//
// The simplest of the three purchase forms, and every omission is deliberate.
// There is no purchase order number field (the backend assigns "UPO-<id>" —
// there is no vendor document to take a number from), no GST column, no tax
// heads, no vendor invoice PDF picker and no invoice raised on save: an
// unbilled purchase is stock bought without a bill, so there is nothing to
// tax and nothing to attach.
//
// What it has that neither of the others does is a product field that ACCEPTS
// A NEW NAME. A local-market buy is by definition a thing that is not in the
// catalogue, so each line either picks an unbilled product already on file or
// types a name, and the backend creates a minimal product row from it (no HSN
// code, 0% GST, never storefront-visible) the first time that name is used.
// Typing a name that already exists finds that product rather than making a
// second one — unbilled products are told apart by name.
//
// The vendor picker offers every active vendor, including those with no GSTIN.
// That is the point: a supplier who raises no bill routinely has no GST number
// on file, and the billed forms' _require_vendor_has_gst rule would rule out
// exactly the vendors this form exists for.
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type {
  UnbilledProductOption,
  UnbilledPurchaseOrder,
} from "@/lib/unbilled-purchase-orders";
import type { VendorOption } from "@/lib/vendors";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

type LineItem = {
  // The product this line buys, held as the NAME rather than an id — the
  // name is what identifies an unbilled product, and a line is allowed to
  // name one that doesn't exist yet. productId below is filled in only when
  // the typed name matched something already on file, and is what stops the
  // backend having to re-match a product the form already resolved.
  productName: string;
  productId: number | null;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput (see lib/decimal-input.ts)
  // rather than a controlled type="number" input, same reasoning as the
  // other two purchase forms' LineItem.rate.
  rate: string;
};

function emptyLineItem(): LineItem {
  return { productName: "", productId: null, quantity: 1, rate: "" };
}

// Reassembles an existing order's parallel arrays (see
// lib/unbilled-purchase-orders.ts) back into per-line-item rows. Every line
// of a saved order has resolved to a real product, so productId is always
// set here — only a freshly typed name leaves it null.
function lineItemsFromOrder(order: UnbilledPurchaseOrder): LineItem[] {
  if (order.productIds.length === 0) return [emptyLineItem()];
  return order.productIds.map((productId, index) => ({
    productName: order.productNames[index] ?? "",
    productId,
    quantity: order.quantities[index] ?? 1,
    rate: String(order.rates[index] ?? ""),
  }));
}

function normalisedName(productName: string): string {
  // Mirrors _normalised_product_name in backend/app/api/routes/products.py,
  // so the form agrees with the backend about when a typed name is one it
  // already has. Used only to decide whether to show the "new product" hint
  // and to fill productId — the backend re-checks either way.
  return productName.trim().split(/\s+/).join(" ").toLowerCase();
}

export function UnbilledPurchaseOrderFormModal({
  mode,
  initialOrder,
  vendors,
  unbilledProducts,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialOrder?: UnbilledPurchaseOrder;
  vendors: VendorOption[];
  // Unbilled products already on file, from GET /admin/get_unbilled_products.
  // Backs the datalist below: the admin can pick one or type past it.
  unbilledProducts: UnbilledProductOption[];
  onClose: () => void;
  // No order payload — the parent re-fetches the authoritative list, same as
  // the other two purchase forms.
  onSaved: () => void;
}) {
  const [vendorId, setVendorId] = useState<string | null>(
    initialOrder ? String(initialOrder.vendorId) : null,
  );
  const [date, setDate] = useState(
    initialOrder ? toDatetimeLocalValue(initialOrder.date) : nowAsDatetimeLocalValue(),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialOrder ? lineItemsFromOrder(initialOrder) : [emptyLineItem()],
  );
  const [description, setDescription] = useState(initialOrder?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit unbilled purchase" : "New unbilled purchase";

  // A plain <select> would be wrong here — the whole point is that the
  // product may not be on the list yet — so this is a text input backed by a
  // <datalist>, which offers what exists without refusing anything else.
  const productsByName = useMemo(
    () => new Map(unbilledProducts.map((product) => [normalisedName(product.productName), product])),
    [unbilledProducts],
  );

  const totalAmount = lineItems.reduce(
    (sum, item) => sum + item.quantity * (Number(item.rate) || 0),
    0,
  );

  function updateLineItem(index: number, changes: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  // Re-resolves the typed name on every keystroke, so productId and the
  // "will be created" hint always agree with what's in the box. Picking an
  // existing product also fills the rate from what it last cost, which is
  // usually right for a repeat buy and is editable when it isn't.
  function handleProductNameChange(index: number, productName: string) {
    const match = productsByName.get(normalisedName(productName));
    updateLineItem(index, {
      productName,
      productId: match?.id ?? null,
      ...(match && !lineItems[index].rate ? { rate: String(match.vendorRate) } : {}),
    });
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function submitPayload() {
    setStatus("saving");
    setError(null);

    const payload = {
      ...(isEdit ? { id: initialOrder?.id } : {}),
      vendor_id: Number(vendorId),
      date: fromDatetimeLocalValue(date),
      // Parallel arrays, one entry per line item. A null in product_ids is
      // a product the backend has to create from the matching product_names
      // entry — see the schema's UnbilledPurchaseOrderLineItems.
      product_ids: lineItems.map((item) => item.productId),
      product_names: lineItems.map((item) => item.productName.trim()),
      quantities: lineItems.map((item) => item.quantity),
      rates: lineItems.map((item) => Number(item.rate) || 0),
      description,
    };

    try {
      const response = await apiFetch(
        isEdit
          ? "/admin/update_unbilled_purchase_order_details"
          : "/admin/create_new_unbilled_purchase_order",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        // Surface the backend's own reason — a 409 here usually means the
        // typed name is already taken by a billed product with no HSN code,
        // and a 400 that an edit would take stock negative.
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

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    void submitPayload();
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unbilled-purchase-order-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="unbilled-purchase-order-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Purchase no.</span>
              <p className={styles.pageSubtext}>
                {isEdit ? initialOrder?.purchaseOrderNo : "Assigned automatically on save"}
              </p>
            </div>

            {/* A plain <select>, not the SingleSelectDropdown the billed
                forms use: there is no GSTIN or vendor-type rule to filter
                by here, so the list is short and unfiltered and the extra
                search UI would earn nothing. */}
            <div>
              <label htmlFor="unbilledVendor" className={styles.formLabel}>
                Vendor<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="unbilledVendor"
                required
                value={vendorId ?? ""}
                onChange={(e) => setVendorId(e.target.value || null)}
                className={styles.formInput}
              >
                <option value="" disabled>
                  Select a vendor
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                    {vendor.gst ? "" : " (no GST)"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="unbilledPurchaseDate" className={styles.formLabel}>
                Date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="unbilledPurchaseDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
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

            <div className={styles.unbilledLineItemsHeaderRow}>
              <span className={styles.formLabel}>
                Product<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Quantity<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>
                Rate<span className={styles.requiredMark}>*</span>
              </span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {/* One shared datalist for every row — the options are the same
                on each, and duplicating it per line would put N copies of
                the whole product list in the DOM. */}
            <datalist id="unbilled-product-names">
              {unbilledProducts.map((product) => (
                <option key={product.id} value={product.productName} />
              ))}
            </datalist>

            {lineItems.map((item, index) => (
              <div key={index} className={styles.unbilledLineItemRow}>
                <div>
                  <input
                    type="text"
                    required
                    list="unbilled-product-names"
                    value={item.productName}
                    onChange={(e) => handleProductNameChange(index, e.target.value)}
                    placeholder="e.g. Jute Pouch"
                    aria-label={`Line ${index + 1} product`}
                    className={styles.formInput}
                  />
                  {/* Says plainly when saving will create a product, so an
                      admin who meant to pick an existing one notices the
                      typo before it becomes a second product. */}
                  {item.productName.trim() !== "" && item.productId === null && (
                    <p className={styles.formHint}>New product — will be created on save.</p>
                  )}
                </div>

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

          <div>
            <label htmlFor="unbilledPurchaseDescription" className={styles.formLabel}>
              Description<span className={styles.requiredMark}>*</span>
            </label>
            <textarea
              id="unbilledPurchaseDescription"
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total paid</p>
              <p className={styles.totalsRowValue}>₹{totalAmount.toFixed(2)}</p>
            </div>
          </div>

          {/* Says plainly what this order does and doesn't do, because the
              two forms next door look alike and behave differently. */}
          <p className={styles.formHint}>
            No GST and no purchase invoice — this records what was paid. Stock is added to inventory as an
            unbilled item and can be sold on a sales order.
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
