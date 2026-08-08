"use client";

// ---------------------------------------------------------------------------
// <InvoiceFormModal> — add/edit popup on the Invoices tab
// ---------------------------------------------------------------------------
// An invoice always raises against an existing sales order — there's no
// line-item entry here (unlike sales-order-form-modal.tsx); totals are just
// read from the selected sales order (lib/sales-orders.ts) and previewed
// live. Mirrors sales-order-form-modal.tsx's add/edit split:
//   - mode "add"  -> POST /admin/create_new_invoice
//   - mode "edit" -> POST /admin/update_invoice_details (sales order is
//                    immutable once raised — shown read-only)
// Both live in backend/app/api/routes/invoices.py.
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { fromDatetimeLocalValue, nowAsDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/datetime-input";
import type { Invoice, InvoiceType, OnlineOrOffline } from "@/lib/invoices";
import { createInvoice, updateInvoice } from "@/lib/invoices";
import type { SalesOrder } from "@/lib/sales-orders";
import type { CustomerOption } from "@/lib/customers";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

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
  const [salesId, setSalesId] = useState<string | null>(
    initialInvoice ? String(initialInvoice.salesId) : null,
  );
  const [date, setDate] = useState(
    initialInvoice ? toDatetimeLocalValue(initialInvoice.date) : nowAsDatetimeLocalValue(),
  );
  const [type, setType] = useState<InvoiceType>(initialInvoice?.type ?? "standard");
  const [dueDate, setDueDate] = useState(
    initialInvoice ? toDatetimeLocalValue(initialInvoice.dueDate) : nowAsDatetimeLocalValue(),
  );
  const [onlineOrOffline, setOnlineOrOffline] = useState<OnlineOrOffline>(
    initialInvoice?.onlineOrOffline ?? "offline",
  );
  const [transport, setTransport] = useState(initialInvoice?.transport ?? "Hand Delivery");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = mode === "edit";
  const wasDeleted = initialInvoice?.isDeleted ?? false;
  const title = isEdit ? "Edit invoice" : "New invoice";

  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const salesOrderOptions: SingleSelectOption[] = useMemo(
    () =>
      salesOrders
        .filter((order) => !order.isDeleted)
        .map((order) => ({
          value: String(order.id),
          label: `SO-${order.orderNo} · ${customersById.get(order.custId)?.name ?? "Unknown customer"}`,
          isDeleted: false,
        })),
    [salesOrders, customersById],
  );
  const selectedSalesOrder = salesOrders.find((order) => String(order.id) === salesId) ?? null;

  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);

    const payload = {
      id: initialInvoice?.id,
      salesId: Number(salesId),
      date: fromDatetimeLocalValue(date),
      type,
      dueDate: fromDatetimeLocalValue(dueDate),
      onlineOrOffline,
      transport,
      isDeleted: isDeletedValue,
    };

    try {
      const response = isEdit ? await updateInvoice(payload) : await createInvoice(payload);

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

    if (!salesId) {
      setError("Please select a sales order.");
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
                <p className={styles.pageSubtext}>{initialInvoice?.invoiceNo}</p>
              </div>
            ) : (
              <div>
                <span className={styles.formLabel}>Invoice no.</span>
                <p className={styles.pageSubtext}>Assigned automatically on save</p>
              </div>
            )}

            {isEdit ? (
              <div>
                <span className={styles.formLabel}>Sales order</span>
                <p className={styles.pageSubtext}>
                  SO-{selectedSalesOrder?.orderNo} · {customersById.get(selectedSalesOrder?.custId ?? -1)?.name ?? "—"}
                </p>
              </div>
            ) : (
              <SingleSelectDropdown
                label="Sales order"
                placeholder="Select a sales order"
                entityLabel="sales orders"
                required
                showStatusFilter={false}
                options={salesOrderOptions}
                selectedValue={salesId}
                onChange={setSalesId}
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

            <div>
              <label htmlFor="invoiceType" className={styles.formLabel}>
                Type<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="invoiceType"
                required
                value={type}
                onChange={(e) => setType(e.target.value as InvoiceType)}
                className={styles.formInput}
              >
                <option value="standard">Standard</option>
                <option value="proforma">Proforma</option>
              </select>
            </div>

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

          {selectedSalesOrder && (
            <div className={styles.totalsRow}>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total before tax</p>
                <p className={styles.totalsRowValue}>₹{selectedSalesOrder.totalAmountBeforeTax.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total tax</p>
                <p className={styles.totalsRowValue}>₹{selectedSalesOrder.totalTaxAmount.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total after tax</p>
                <p className={styles.totalsRowValue}>₹{selectedSalesOrder.totalAmountAfterTax.toFixed(2)}</p>
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
