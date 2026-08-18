"use client";

// ---------------------------------------------------------------------------
// <SalesOrderFormModal> — add/edit popup on the Sales orders tab of
// /admin/orders
// ---------------------------------------------------------------------------
// Mirrors purchase-order-form-modal.tsx's line-item structure:
//   - mode "add"  -> POST /admin/create_new_sales_order
//   - mode "edit" -> POST /admin/update_sales_order_details (existing order,
//                    looked up by id)
// Both live in backend/app/api/routes/sales_orders.py.
//
// Differences from the purchase order form:
//   - Tax is captured per line item (tax %, auto-filled from the product's
//     gst_perc but editable) rather than as flat order-level SGST/CGST/IGST
//     amounts — order totals are just the sums of the line items.
//   - The product picker is a searchable SingleSelectDropdown (not a plain
//     <select>) and isn't scoped to a vendor — a sales order can mix
//     products from any vendor's catalogue.
//   - order_no is backend-assigned (via OrderNoCounterMaster) and never
//     submitted; shown read-only in edit mode.
//   - order_status_id is only ever shown/submitted in edit mode — new orders
//     are silently defaulted to "New" on the backend. Sourced from
//     GET /admin/get_order_status_list.
//   - related_purchase_order_ids is an optional MultiSelectDropdown sourced
//     from GET /admin/get_purchase_order_list.
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch } from "@/lib/api";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { SalesOrder } from "@/lib/sales-orders";
import type { CustomerOption } from "@/lib/customers";
import type { Product } from "@/lib/products";
import type { PurchaseOrderOption } from "@/lib/purchase-orders";
import type { OrderStatus } from "@/lib/order-status";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

type LineItem = {
  productId: string | null;
  quantity: number;
  // Plain text, sanitized via sanitizeDecimalInput (see lib/decimal-input.ts)
  // rather than a controlled type="number" input, same reasoning as
  // purchase-order-form-modal.tsx's LineItem.rate.
  rate: string;
  taxPerc: string;
};

function emptyLineItem(): LineItem {
  return { productId: null, quantity: 1, rate: "", taxPerc: "" };
}

// Reassembles an existing order's parallel productIds/quantities/rates/
// taxPercs arrays (see lib/sales-orders.ts) back into per-line-item rows for
// the form's local state.
function lineItemsFromOrder(order: SalesOrder): LineItem[] {
  if (order.productIds.length === 0) return [emptyLineItem()];
  return order.productIds.map((productId, index) => ({
    productId: String(productId),
    quantity: order.quantities[index] ?? 1,
    rate: String(order.rates[index] ?? ""),
    taxPerc: String(order.taxPercs[index] ?? ""),
  }));
}

export function SalesOrderFormModal({
  mode,
  initialOrder,
  customers,
  products,
  purchaseOrders,
  orderStatuses,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialOrder?: SalesOrder;
  customers: CustomerOption[];
  products: Product[];
  purchaseOrders: PurchaseOrderOption[];
  orderStatuses: OrderStatus[];
  onClose: () => void;
  // No order payload — the backend only returns {message} (see
  // create_new_sales_order/update_sales_order_details), so the parent
  // re-fetches the authoritative list from GET /admin/get_sales_order_details.
  onSaved: () => void;
}) {
  const [custId, setCustId] = useState<string | null>(initialOrder ? String(initialOrder.custId) : null);
  const [date, setDate] = useState(
    initialOrder ? toDatetimeLocalValue(initialOrder.date) : nowAsDatetimeLocalValue(),
  );
  const [orderStatusId, setOrderStatusId] = useState<string | null>(
    initialOrder ? String(initialOrder.orderStatusId) : null,
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    initialOrder ? lineItemsFromOrder(initialOrder) : [emptyLineItem()],
  );
  const [relatedPurchaseOrderIds, setRelatedPurchaseOrderIds] = useState<string[]>(
    initialOrder?.relatedPurchaseOrderIds.map(String) ?? [],
  );
  const [description, setDescription] = useState(initialOrder?.description ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit sales order" : "New sales order";

  const customerOptions: SingleSelectOption[] = customers.map((customer) => ({
    value: String(customer.id),
    label: customer.name,
    isDeleted: customer.isDeleted,
  }));

  const orderStatusOptions: SingleSelectOption[] = orderStatuses.map((orderStatus) => ({
    value: String(orderStatus.id),
    label: orderStatus.statusName,
    isDeleted: false,
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

  const purchaseOrderOptions: MultiSelectOption[] = purchaseOrders.map((purchaseOrder) => ({
    value: String(purchaseOrder.id),
    label: `PO-${purchaseOrder.purchaseOrderNo} · ${purchaseOrder.vendorName}`,
  }));

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

  // Sales orders are never deleted from this form — an edit always writes
  // back whatever is_deleted the order already had (always false in
  // practice, since the list endpoint only returns active orders).
  async function submitPayload() {
    setStatus("saving");
    setError(null);

    const productIds = lineItems.map((item) => Number(item.productId));
    const quantities = lineItems.map((item) => item.quantity);
    const rates = lineItems.map((item) => Number(item.rate) || 0);
    const taxPercs = lineItems.map((item) => Number(item.taxPerc) || 0);

    const payload = {
      ...(isEdit
        ? { id: initialOrder?.id, order_status_id: Number(orderStatusId), is_deleted: initialOrder?.isDeleted ?? false }
        : {}),
      cust_id: Number(custId),
      date: fromDatetimeLocalValue(date),
      product_ids: productIds,
      quantities,
      rates,
      tax_percs: taxPercs,
      description,
      related_purchase_order_ids: relatedPurchaseOrderIds.map(Number),
    };

    try {
      const response = await apiFetch(isEdit ? "/admin/update_sales_order_details" : "/admin/create_new_sales_order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // Surface the backend's actual reason (e.g. "customer not found",
        // "product 12 not found") instead of guessing.
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

    if (!custId) {
      setError("Please select a customer.");
      return;
    }

    if (isEdit && !orderStatusId) {
      setError("Please select an order status.");
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
        aria-labelledby="sales-order-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="sales-order-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {isEdit && initialOrder?.poUpdatedFlag && (
            <p className={styles.poUpdatedNotice}>
              A related purchase order was edited since this sales order was last saved. Review the line items/totals
              below and Save to clear this notice.
            </p>
          )}

          <div className={styles.formGrid}>
            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Order no.</span>
                <p className={styles.pageSubtext}>{initialOrder?.orderNo}</p>
              </div>
            ) : (
              <div>
                <span className={styles.formLabel}>Order no.</span>
                <p className={styles.pageSubtext}>Assigned automatically on save</p>
              </div>
            )}

            <SingleSelectDropdown
              label="Customer"
              placeholder="Select a customer"
              entityLabel="customers"
              required
              // Active/Deleted toggle removed — only active customers are
              // browsable here. A deleted customer already assigned to this
              // order still resolves and displays correctly (customerOptions
              // includes deleted rows), it's just not selectable going
              // forward.
              showStatusFilter={false}
              options={customerOptions}
              selectedValue={custId}
              onChange={setCustId}
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

            {isEdit && (
              <SingleSelectDropdown
                label="Order status"
                placeholder="Select a status"
                entityLabel="statuses"
                required
                // orderStatusOptions is never marked deleted (it's the fixed
                // seeded status list), so the Active/Deleted toggle would
                // just be a permanently-empty "Deleted" tab.
                showStatusFilter={false}
                options={orderStatusOptions}
                selectedValue={orderStatusId}
                onChange={setOrderStatusId}
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
                    // productOptions already excludes soft-deleted products
                    // (they should never be orderable), so the
                    // Active/Deleted toggle would just be a
                    // permanently-empty "Deleted" tab.
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

          <MultiSelectDropdown
            label="Related purchase orders (optional)"
            placeholder="Link purchase orders this order fulfills from"
            searchPlaceholder="Search purchase orders…"
            emptyMessage="No purchase orders match."
            options={purchaseOrderOptions}
            selectedValues={relatedPurchaseOrderIds}
            onChange={setRelatedPurchaseOrderIds}
          />

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
            {/* No delete action here — sales orders can't be deleted from
                the admin UI, only edited. */}
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
