"use client";

// ---------------------------------------------------------------------------
// <InvoiceFormModal> — add/edit popup on the Standard view of the Sales Invoices tab
// ---------------------------------------------------------------------------
// Standard-only — an invoice always raises against one or more existing
// sales orders — there's no line-item entry here (unlike
// sales-order-form-modal.tsx); totals are just summed from the selected
// sales orders (lib/sales-orders.ts) and previewed live. All selected sales
// orders must belong to the same customer (an invoice PDF only has room for
// one customer name/address) — picking the first sales order locks the
// picker to that customer's other orders, mirroring how
// purchase-order-form-modal.tsx scopes its product picker to one vendor.
// Proforma invoices have their own dedicated modal
// (proforma-invoice-form-modal.tsx), since they carry their own line items
// instead of a sales-order link.
//   - mode "add"  -> POST /admin/create_new_invoice
//   - mode "edit" -> POST /admin/update_invoice_details (salesIds is
//                    immutable once raised — shown read-only)
// Both live in backend/app/api/routes/invoices.py.
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { Invoice, InvoiceStatus, OnlineOrOffline } from "@/lib/invoices";
import { createInvoice, updateInvoice } from "@/lib/invoices";
import type { SalesOrder } from "@/lib/sales-orders";
import type { CustomerOption } from "@/lib/customers";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const INVOICE_STATUS_OPTIONS: SingleSelectOption[] = [
  { value: "new", label: "New", isDeleted: false },
  { value: "submitted", label: "Submitted", isDeleted: false },
  { value: "paid", label: "Paid", isDeleted: false },
];

export function InvoiceFormModal({
  mode,
  initialInvoice,
  salesOrders,
  customers,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialInvoice?: Invoice;
  salesOrders: SalesOrder[];
  customers: CustomerOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [salesIds, setSalesIds] = useState<string[]>(
    initialInvoice ? initialInvoice.salesIds.map(String) : [],
  );
  const [date, setDate] = useState(
    initialInvoice ? toDatetimeLocalValue(initialInvoice.date) : nowAsDatetimeLocalValue(),
  );
  const [dueDate, setDueDate] = useState(
    initialInvoice ? toDatetimeLocalValue(initialInvoice.dueDate) : nowAsDatetimeLocalValue(),
  );
  const [onlineOrOffline, setOnlineOrOffline] = useState<OnlineOrOffline>(
    initialInvoice?.onlineOrOffline ?? "offline",
  );
  const [transport, setTransport] = useState(initialInvoice?.transport ?? "Hand Delivery");
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>(initialInvoice?.status ?? "new");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialInvoice?.isDeleted ?? false;
  const title = isEdit ? "Edit invoice" : "New invoice";

  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const selectedSalesOrders = useMemo(
    () => salesIds.map((id) => salesOrders.find((order) => String(order.id) === id)).filter((o): o is SalesOrder => !!o),
    [salesIds, salesOrders],
  );
  // Locks the picker to one customer once the first sales order is chosen —
  // an invoice PDF only shows one customer name/address (see
  // _check_same_customer in routes/invoices.py, which enforces this
  // server-side too).
  const lockedCustId = selectedSalesOrders[0]?.custId ?? null;
  const salesOrderOptions: MultiSelectOption[] = useMemo(
    () =>
      salesOrders
        .filter((order) => !order.isDeleted && (lockedCustId === null || order.custId === lockedCustId))
        .map((order) => ({
          value: String(order.id),
          label: `SO-${order.orderNo} · ${customersById.get(order.custId)?.name ?? "Unknown customer"}`,
        })),
    [salesOrders, customersById, lockedCustId],
  );

  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    try {
      const response = isEdit
        ? await updateInvoice({
            id: initialInvoice!.id,
            date: fromDatetimeLocalValue(date),
            dueDate: fromDatetimeLocalValue(dueDate),
            onlineOrOffline,
            transport,
            status: invoiceStatus,
            isDeleted: isDeletedValue,
          })
        : await createInvoice({
            salesIds: salesIds.map(Number),
            date: fromDatetimeLocalValue(date),
            dueDate: fromDatetimeLocalValue(dueDate),
            onlineOrOffline,
            transport,
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

    if (!isEdit && salesIds.length === 0) {
      setError("Please select at least one sales order.");
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
        aria-labelledby="invoice-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="invoice-modal-title" className={styles.modalTitle}>
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

            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Sales order{selectedSalesOrders.length > 1 ? "s" : ""}</span>
                <p className={styles.pageSubtext}>
                  {selectedSalesOrders.length > 0
                    ? selectedSalesOrders.map((order) => `SO-${order.orderNo}`).join(", ")
                    : "—"}
                  {" · "}
                  {customersById.get(selectedSalesOrders[0]?.custId ?? -1)?.name ?? "—"}
                </p>
              </div>
            ) : (
              <MultiSelectDropdown
                label="Sales orders"
                placeholder="Select sales orders"
                searchPlaceholder="Search sales orders…"
                emptyMessage="No sales orders match."
                options={salesOrderOptions}
                selectedValues={salesIds}
                onChange={setSalesIds}
              />
            )}

            <div>
              <label htmlFor="invoiceDate" className={styles.formLabel}>
                Invoice date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="invoiceDate"
                type="datetime-local"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label htmlFor="dueDate" className={styles.formLabel}>
                Due date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="dueDate"
                type="datetime-local"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
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
                options={INVOICE_STATUS_OPTIONS}
                selectedValue={invoiceStatus}
                onChange={(value) => setInvoiceStatus(value as InvoiceStatus)}
              />
            )}

            <div>
              <label htmlFor="onlineOrOffline" className={styles.formLabel}>
                Payment<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="onlineOrOffline"
                required
                value={onlineOrOffline}
                onChange={(e) => setOnlineOrOffline(e.target.value as OnlineOrOffline)}
                className={styles.formInput}
              >
                <option value="offline">Offline</option>
                <option value="online">Online</option>
              </select>
            </div>

            <div>
              <label htmlFor="transport" className={styles.formLabel}>
                Transport
              </label>
              <input
                id="transport"
                type="text"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          {!isEdit && selectedSalesOrders.length > 0 && (
            <div className={styles.totalsRow}>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total before tax</p>
                <p className={styles.totalsRowValue}>
                  ₹{selectedSalesOrders.reduce((sum, o) => sum + o.totalAmountBeforeTax, 0).toFixed(2)}
                </p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total tax</p>
                <p className={styles.totalsRowValue}>
                  ₹{selectedSalesOrders.reduce((sum, o) => sum + o.totalTaxAmount, 0).toFixed(2)}
                </p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total after tax</p>
                <p className={styles.totalsRowValue}>
                  ₹{selectedSalesOrders.reduce((sum, o) => sum + o.totalAmountAfterTax, 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          {isEdit && (
            <div className={styles.totalsRow}>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total before tax</p>
                <p className={styles.totalsRowValue}>₹{initialInvoice!.totalAmountBeforeTax.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total tax</p>
                <p className={styles.totalsRowValue}>₹{initialInvoice!.totalTaxAmount.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total after tax</p>
                <p className={styles.totalsRowValue}>₹{initialInvoice!.totalAmountAfterTax.toFixed(2)}</p>
              </div>
            </div>
          )}

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
