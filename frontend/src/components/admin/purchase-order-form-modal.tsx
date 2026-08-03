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
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import type { PurchaseOrder } from "@/lib/purchase-orders";
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

export function PurchaseOrderFormModal({
  mode,
  initialOrder,
  vendors,
  products,
  nextPurchaseOrderNo,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialOrder?: PurchaseOrder;
  vendors: VendorOption[];
  products: Product[];
  nextPurchaseOrderNo: number;
  onClose: () => void;
  // No order payload — the backend only returns {message} (see
  // create_new_purchase_order/update_purchase_order_details), so the parent
  // re-fetches the authoritative list from GET /admin/get_purchase_order_details
  // rather than the caller reconstructing one client-side (which is what
  // produced a fake id: 0 for new orders, breaking their very next edit).
  onSaved: () => void;
}) {
  const [vendorId, setVendorId] = useState<string | null>(
    initialOrder ? String(initialOrder.vendorId) : null,
  );
  const [purchaseOrderNo, setPurchaseOrderNo] = useState(initialOrder?.purchaseOrderNo ?? nextPurchaseOrderNo);
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialOrder ? lineItemsFromOrder(initialOrder) : [emptyLineItem()],
  );
  // Plain text, sanitized via sanitizeDecimalInput — same reasoning as
  // LineItem.rate above, so these don't start as a "0" that has to be
  // deleted before typing a real amount.
  const [sgstAmount, setSgstAmount] = useState(initialOrder?.sgstAmount != null ? String(initialOrder.sgstAmount) : "");
  const [cgstAmount, setCgstAmount] = useState(initialOrder?.cgstAmount != null ? String(initialOrder.cgstAmount) : "");
  const [igstAmount, setIgstAmount] = useState(initialOrder?.igstAmount != null ? String(initialOrder.igstAmount) : "");
  const [description, setDescription] = useState(initialOrder?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit purchase order" : "New purchase order";

  // vendors comes from GET /admin/get_vendors_list, which only returns active
  // vendors, so isDeleted is always false here.
  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
    isDeleted: false,
  }));

  // A purchase order is placed with a single vendor, so line items can only
  // draw from that vendor's own products — until a vendor is picked, the
  // product picker has nothing to offer and stays disabled (see the <select>
  // below) rather than falling back to every product.
  const availableProducts = useMemo(
    () => (vendorId ? products.filter((p) => p.vendorId === Number(vendorId)) : []),
    [products, vendorId],
  );
  const productsById = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

  const totalAmountBeforeTax = lineItems.reduce((sum, item) => sum + item.quantity * (Number(item.rate) || 0), 0);
  const totalAmountAfterTax =
    totalAmountBeforeTax + (Number(sgstAmount) || 0) + (Number(cgstAmount) || 0) + (Number(igstAmount) || 0);

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

    // product_ids/quantities/rates are parallel arrays, one entry per line
    // item — the backend re-derives the totals from these rather than
    // trusting totalAmountBeforeTax/AfterTax computed here.
    const productIds = lineItems.map((item) => Number(item.productId));
    const quantities = lineItems.map((item) => item.quantity);
    const rates = lineItems.map((item) => Number(item.rate) || 0);
    const sgstAmountValue = Number(sgstAmount) || null;
    const cgstAmountValue = Number(cgstAmount) || null;
    const igstAmountValue = Number(igstAmount) || null;

    const payload = {
      ...(isEdit ? { id: initialOrder?.id } : {}),
      purchase_order_no: purchaseOrderNo,
      vendor_id: Number(vendorId),
      product_ids: productIds,
      quantities,
      rates,
      sgst_amount: sgstAmountValue,
      cgst_amount: cgstAmountValue,
      igst_amount: igstAmountValue,
      description,
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

      onSaved();
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
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
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="purchaseOrderNo" className={styles.formLabel}>
                Purchase order no.
              </label>
              <input
                id="purchaseOrderNo"
                type="number"
                min={1}
                required
                value={purchaseOrderNo}
                onChange={(e) => setPurchaseOrderNo(Number(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Vendor"
              placeholder="Select a vendor"
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={handleVendorChange}
            />
          </div>

          <div className={styles.lineItemsSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Line items</span>
              <button type="button" onClick={addLineItem} className={styles.addContactButton}>
                + Add line item
              </button>
            </div>

            <div className={styles.lineItemsHeaderRow}>
              <span className={styles.formLabel}>Product</span>
              <span className={styles.formLabel}>Quantity</span>
              <span className={styles.formLabel}>Rate</span>
              <span className={styles.formLabel}>Line total</span>
              <span />
            </div>

            {lineItems.map((item, index) => (
              <div key={index} className={styles.lineItemRow}>
                <select
                  value={item.productId ?? ""}
                  onChange={(e) => handleProductChange(index, e.target.value)}
                  required
                  disabled={!vendorId}
                  aria-label={`Line ${index + 1} product`}
                  className={styles.formInput}
                >
                  <option value="" disabled>
                    {vendorId ? "Select a product…" : "Select a vendor first"}
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

          <div className={styles.totalsGrid}>
            <div>
              <label htmlFor="sgstAmount" className={styles.formLabel}>
                SGST amount
              </label>
              <input
                id="sgstAmount"
                type="text"
                inputMode="decimal"
                value={sgstAmount}
                onChange={(e) => setSgstAmount(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="cgstAmount" className={styles.formLabel}>
                CGST amount
              </label>
              <input
                id="cgstAmount"
                type="text"
                inputMode="decimal"
                value={cgstAmount}
                onChange={(e) => setCgstAmount(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="igstAmount" className={styles.formLabel}>
                IGST amount
              </label>
              <input
                id="igstAmount"
                type="text"
                inputMode="decimal"
                value={igstAmount}
                onChange={(e) => setIgstAmount(sanitizeDecimalInput(e.target.value))}
                className={styles.formInput}
              />
            </div>
          </div>

          <div>
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

          <div className={styles.totalsRow}>
            <div className={styles.totalsRowItem}>
              <p className={styles.totalsRowLabel}>Total before tax</p>
              <p className={styles.totalsRowValue}>₹{totalAmountBeforeTax.toFixed(2)}</p>
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
