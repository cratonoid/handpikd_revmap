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
// An invoice is Full (the default) or Partial, an advance of a percentage
// or a fixed amount of the orders' value. Partials can be raised again and
// again on the same orders until they add up to the orders' value; a Full
// invoice then bills what they left, and closes the orders. So the picker
// leaves out any order a live Full invoice already lists (the `invoices`
// prop — voided ones don't count, their orders are free again), and picking
// an order that already has partials selects exactly the orders on them,
// since partials and the Full after them must list the same orders. The
// backend enforces the same rules (_check_billing_room in
// routes/invoices.py) in case two admins pick from stale lists. Cancelled sales
// orders are left out too — there's nothing to bill (_check_not_cancelled).
// Proforma invoices have their own dedicated modal
// (proforma-invoice-form-modal.tsx), since they carry their own line items
// instead of a sales-order link.
//
// Three ways in (see InvoiceState in lib/invoices.ts):
//   - new    -> POST /admin/create_new_invoice, always saved as a draft
//   - draft  -> everything editable but the sales orders, billing included;
//               "Save draft" posts update_invoice_details, "Issue invoice"
//               saves then posts issue_invoice (numbers and freezes it), and
//               "Delete draft" posts delete_draft_invoice
//   - issued -> read-only except the payment status, plus Cancel/Restore
// All live in backend/app/api/routes/invoices.py.
import { useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/button";
import {
  addDaysToDatetimeLocalValue,
  fromDatetimeLocalValue,
  nowAsDateValue,
  nowAsDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/datetime-input";
import type { Invoice, InvoiceBilling, InvoiceStatus, OnlineOrOffline } from "@/lib/invoices";
import {
  billedTotals,
  createInvoice,
  deleteDraftInvoice,
  issueInvoice,
  printInvoicePdf,
  updateInvoice,
} from "@/lib/invoices";
import type { SalesOrder } from "@/lib/sales-orders";
import type { CustomerOption } from "@/lib/customers";
import { formatDate } from "@/lib/format-date";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";
type PartialMode = "percent" | "amount";
// Which "Are you sure?" row is showing, if any.
type Confirming = null | "cancel" | "delete" | "issue";

const BILLING_OPTIONS: { value: InvoiceBilling; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "partial", label: "Partial" },
];

const PARTIAL_MODE_OPTIONS: { value: PartialMode; label: string }[] = [
  { value: "percent", label: "%" },
  { value: "amount", label: "₹ Amount" },
];

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sameOrders(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

// New invoices default their due date to invoice date + this many days.
const DUE_DATE_DAYS = 10;

const INVOICE_STATUS_OPTIONS: SingleSelectOption[] = [
  { value: "unpaid", label: "Unpaid", isDeleted: false },
  { value: "paid", label: "Paid", isDeleted: false },
];

export function InvoiceFormModal({
  mode,
  initialInvoice,
  salesOrders,
  cancelledStatusIds,
  invoices,
  customers,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  initialInvoice?: Invoice;
  salesOrders: SalesOrder[];
  // OrderStatusMaster ids of "Cancelled" — those orders are hidden from the picker.
  cancelledStatusIds: number[];
  // Every live invoice — used only to hide sales orders already billed.
  invoices: Invoice[];
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
    initialInvoice
      ? toDatetimeLocalValue(initialInvoice.dueDate)
      : addDaysToDatetimeLocalValue(nowAsDatetimeLocalValue(), DUE_DATE_DAYS),
  );
  // On a new invoice the due date tracks invoice date + DUE_DATE_DAYS until
  // the admin edits it by hand; after that it's left alone.
  const [dueDateEdited, setDueDateEdited] = useState(!!initialInvoice);
  const [onlineOrOffline, setOnlineOrOffline] = useState<OnlineOrOffline>(
    initialInvoice?.onlineOrOffline ?? "offline",
  );
  const [transport, setTransport] = useState(initialInvoice?.transport ?? "Hand Delivery");
  const [notes, setNotes] = useState(initialInvoice?.notes ?? "");
  const [billing, setBilling] = useState<InvoiceBilling>(initialInvoice?.billing ?? "full");
  const [partialMode, setPartialMode] = useState<PartialMode>(
    initialInvoice?.partialAmount != null ? "amount" : "percent",
  );
  // The typed %, or rupees including tax, per partialMode.
  const [partialValue, setPartialValue] = useState(
    String(initialInvoice?.partialAmount ?? initialInvoice?.partialPercent ?? ""),
  );
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>(initialInvoice?.status ?? "unpaid");
  // "YYYY-MM-DD", only shown and sent while the status is paid. Filled with
  // today when the status is switched to paid, then editable. Blank on an
  // invoice marked paid before the date was recorded — saving it blank
  // stamps today, same as the backend does.
  const [paidOn, setPaidOn] = useState(initialInvoice?.paidOn ?? "");

  function handleInvoiceStatusChange(next: InvoiceStatus) {
    setInvoiceStatus(next);
    if (next === "paid" && !paidOn) setPaidOn(nowAsDateValue());
  }
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [printing, setPrinting] = useState(false);

  const isEdit = mode === "edit";
  const isDraft = isEdit && initialInvoice?.state === "draft";
  const isIssued = isEdit && !isDraft;
  const wasDeleted = initialInvoice?.isDeleted ?? false;
  // Billing, dates and the rest of the document are open on a new invoice
  // and on a draft; an issued one is frozen.
  const canEditDocument = !isEdit || isDraft;
  const locked = !canEditDocument || wasDeleted;
  const title = !isEdit ? "New invoice" : isDraft ? "Edit draft invoice" : "Invoice";

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
  // Sales orders a live Full invoice already covers. The tab's list includes
  // cancelled invoices, which have released their orders, so the isDeleted
  // checks matter.
  const livePartials = useMemo(
    () => invoices.filter((invoice) => invoice.type === "standard" && !invoice.isDeleted && invoice.billing === "partial"),
    [invoices],
  );
  const invoicedSalesIds = useMemo(
    () =>
      new Set(
        invoices
          .filter((invoice) => invoice.type === "standard" && !invoice.isDeleted && invoice.billing !== "partial")
          .flatMap((invoice) => invoice.salesIds),
      ),
    [invoices],
  );
  // Picking an order that already has partials selects exactly the orders
  // those partials list.
  function handleSalesIdsChange(next: string[]) {
    const added = next.find((id) => !salesIds.includes(id));
    const partialOn = added ? livePartials.find((invoice) => invoice.salesIds.includes(Number(added))) : undefined;
    setSalesIds(partialOn ? partialOn.salesIds.map(String) : next);
  }
  const selectedIds = salesIds.map(Number);
  const partialsOnSelection = livePartials.filter(
    (invoice) => invoice.id !== initialInvoice?.id && sameOrders(invoice.salesIds, selectedIds),
  );
  const orderAfterTax = selectedSalesOrders.reduce((sum, order) => sum + order.totalAmountAfterTax, 0);
  const alreadyBilled = partialsOnSelection.reduce((sum, invoice) => sum + invoice.totalAmountAfterTax, 0);
  const leftToBill = Math.round((orderAfterTax - alreadyBilled) * 100) / 100;
  const partialNumber = Number(partialValue);
  const preview = billedTotals(
    selectedSalesOrders,
    billing,
    {
      percent: partialMode === "percent" ? partialNumber || 0 : null,
      amount: partialMode === "amount" ? partialNumber || 0 : null,
    },
    partialsOnSelection,
  );
  const salesOrderOptions: MultiSelectOption[] = useMemo(
    () =>
      salesOrders
        .filter(
          (order) =>
            !order.isDeleted &&
            !cancelledStatusIds.includes(order.orderStatusId) &&
            !invoicedSalesIds.has(order.id) &&
            (lockedCustId === null || order.custId === lockedCustId),
        )
        .map((order) => ({
          value: String(order.id),
          label: `SO-${order.orderNo} · ${customersById.get(order.custId)?.name ?? "Unknown customer"}`,
        })),
    [salesOrders, cancelledStatusIds, customersById, lockedCustId, invoicedSalesIds],
  );

  const billingPayload = {
    billing,
    partialPercent: billing === "partial" && partialMode === "percent" ? partialNumber : null,
    partialAmount: billing === "partial" && partialMode === "amount" ? partialNumber : null,
  };

  // Saves the form; resolves to whether it went through (the error is shown
  // here when it didn't).
  async function save(isDeletedValue: boolean): Promise<boolean> {
    try {
      const response = isEdit
        ? await updateInvoice({
            id: initialInvoice!.id,
            date: fromDatetimeLocalValue(date),
            dueDate: fromDatetimeLocalValue(dueDate),
            onlineOrOffline,
            transport,
            notes,
            // A draft has no payment state yet.
            status: isDraft ? "unpaid" : invoiceStatus,
            paidOn: paidOn || null,
            isDeleted: isDeletedValue,
            ...(isDraft ? billingPayload : {}),
          })
        : await createInvoice({
            salesIds: salesIds.map(Number),
            date: fromDatetimeLocalValue(date),
            dueDate: fromDatetimeLocalValue(dueDate),
            onlineOrOffline,
            transport,
            notes,
            ...billingPayload,
          });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setError(typeof detail?.detail === "string" ? detail.detail : "Something went wrong. Please try again.");
        return false;
      }
      return true;
    } catch {
      setError("Couldn't reach the server. Please try again.");
      return false;
    }
  }

  async function submitPayload(isDeletedValue: boolean) {
    setStatus("saving");
    setError(null);
    if (await save(isDeletedValue)) {
      onSaved();
    } else {
      setStatus("idle");
    }
  }

  // Issuing saves the draft first, so what gets issued is what's on screen.
  async function saveAndIssue() {
    setConfirming(null);
    setStatus("saving");
    setError(null);
    if (!(await save(false))) {
      setStatus("idle");
      return;
    }
    try {
      await issueInvoice(initialInvoice!.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't issue the invoice. Please try again.");
      setStatus("idle");
    }
  }

  async function handleDeleteDraft() {
    setConfirming(null);
    setStatus("saving");
    setError(null);
    try {
      await deleteDraftInvoice(initialInvoice!.id);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the draft. Please try again.");
      setStatus("idle");
    }
  }

  // The checks a new invoice or a draft has to pass before it's saved or
  // issued. Returns false, with the reason shown, when it doesn't.
  function validate(form: HTMLFormElement): boolean {
    if (!isEdit && salesIds.length === 0) {
      setError("Please select at least one sales order.");
      return false;
    }

    if (canEditDocument && billing === "partial") {
      if (!(partialNumber > 0) || (partialMode === "percent" && partialNumber > 100)) {
        setError(partialMode === "percent" ? "Enter a percentage above 0, up to 100." : "Enter an amount above ₹0.");
        return false;
      }
      if (preview.afterTax > leftToBill + 0.005) {
        setError(`Only ${rupees(Math.max(leftToBill, 0))} of ${rupees(orderAfterTax)} is left to bill on these orders.`);
        return false;
      }
    }
    if (canEditDocument && billing === "full" && partialsOnSelection.length > 0 && leftToBill <= 0.005) {
      setError("These orders are already fully billed by partial invoices.");
      return false;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }
    return true;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate(event.currentTarget)) return;
    void submitPayload(wasDeleted);
  }

  function handleIssueClick(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    setError(null);
    if (form && !validate(form)) return;
    setConfirming("issue");
  }

  function handleCancelOrRestore() {
    setConfirming(null);
    void submitPayload(!wasDeleted);
  }

  // Prints the invoice as it's saved on the server — unsaved edits in the
  // form aren't on the PDF, which is why the button only exists in edit mode.
  async function handlePrint() {
    if (!initialInvoice) return;
    setError(null);
    setPrinting(true);
    try {
      await printInvoicePdf(initialInvoice.id);
    } catch {
      setError(`Couldn't generate the PDF for invoice ${initialInvoice.invoiceNoDisplay}.`);
    } finally {
      setPrinting(false);
    }
  }

  const confirmText: Record<Exclude<Confirming, null>, string> = {
    cancel: wasDeleted
      ? "Are you sure you want to restore this invoice?"
      : "Are you sure you want to cancel this invoice?",
    delete: "Delete this draft? It has no number, so nothing is left behind.",
    issue:
      "Issue this invoice? It gets the next invoice number, and after that it can't be changed — only its payment status, or cancelling it.",
  };
  const confirmButton: Record<Exclude<Confirming, null>, string> = {
    cancel: wasDeleted ? "Yes, restore" : "Yes, cancel invoice",
    delete: "Yes, delete draft",
    issue: "Yes, issue invoice",
  };
  function handleConfirm() {
    if (confirming === "issue") void saveAndIssue();
    else if (confirming === "delete") void handleDeleteDraft();
    else handleCancelOrRestore();
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
            <div>
              <span className={styles.formLabel}>Invoice no.</span>
              <p className={styles.pageSubtext}>
                {!isEdit
                  ? "Saved as a draft. The number is given when it's issued."
                  : isDraft
                    ? `${initialInvoice?.invoiceNoDisplay} · draft, numbered when issued`
                    : initialInvoice?.invoiceNoDisplay}
                {isIssued && initialInvoice?.issuedAt && (
                  <>
                    {" "}
                    · issued {formatDate(initialInvoice.issuedAt)}
                    {initialInvoice.issuedBy ? ` by ${initialInvoice.issuedBy}` : ""}
                  </>
                )}
              </p>
            </div>

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
                emptyMessage="No sales orders match. Orders already on a full invoice aren't listed."
                options={salesOrderOptions}
                selectedValues={salesIds}
                onChange={handleSalesIdsChange}
              />
            )}

            {locked ? (
              initialInvoice?.billing === "partial" && (
                <div>
                  <span className={styles.formLabel}>Billing</span>
                  <p className={styles.pageSubtext}>
                    Partial ·{" "}
                    {initialInvoice.partialAmount !== null
                      ? rupees(initialInvoice.partialAmount)
                      : `${initialInvoice.partialPercent}% of the order value`}
                  </p>
                </div>
              )
            ) : (
              <div>
                <span className={styles.formLabel}>Billing</span>
                <div className={styles.viewToggle} role="radiogroup" aria-label="Billing">
                  {BILLING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={billing === option.value}
                      onClick={() => setBilling(option.value)}
                      className={`${styles.viewToggleButton} ${billing === option.value ? styles.viewToggleButtonActive : ""}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!locked && billing === "partial" && (
              <div>
                <label htmlFor="partialValue" className={styles.formLabel}>
                  {partialMode === "percent" ? "Advance (% of order value)" : "Advance amount (incl. tax)"}
                  <span className={styles.requiredMark}>*</span>
                </label>
                <div className={styles.viewToggle} role="radiogroup" aria-label="Enter the advance as">
                  {PARTIAL_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={partialMode === option.value}
                      onClick={() => {
                        setPartialMode(option.value);
                        setPartialValue("");
                      }}
                      className={`${styles.viewToggleButton} ${partialMode === option.value ? styles.viewToggleButtonActive : ""}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <input
                  id="partialValue"
                  type="number"
                  required
                  min={0.01}
                  max={partialMode === "percent" ? 100 : undefined}
                  step={0.01}
                  value={partialValue}
                  onChange={(e) => setPartialValue(e.target.value)}
                  className={styles.formInput}
                />
                {selectedSalesOrders.length > 0 && (
                  <p className={styles.pageSubtext}>
                    {partialMode === "percent"
                      ? `= ${rupees(preview.afterTax)}`
                      : `= ${orderAfterTax ? ((preview.afterTax / orderAfterTax) * 100).toFixed(2) : "0.00"}% of the order value`}
                    {" · "}
                    {rupees(Math.max(leftToBill, 0))} of {rupees(orderAfterTax)} left to bill
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="invoiceDate" className={styles.formLabel}>
                Invoice date<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="invoiceDate"
                type="datetime-local"
                required
                disabled={locked}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (!dueDateEdited && e.target.value) {
                    setDueDate(addDaysToDatetimeLocalValue(e.target.value, DUE_DATE_DAYS));
                  }
                }}
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
                disabled={locked}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setDueDateEdited(true);
                }}
                className={styles.formInput}
              />
            </div>

            {isIssued && (
              <SingleSelectDropdown
                label="Status"
                placeholder="Select a status"
                entityLabel="statuses"
                required
                showStatusFilter={false}
                options={INVOICE_STATUS_OPTIONS}
                selectedValue={invoiceStatus}
                onChange={(value) => handleInvoiceStatusChange(value as InvoiceStatus)}
              />
            )}

            {isIssued && invoiceStatus === "paid" && (
              <div>
                <label htmlFor="paidOn" className={styles.formLabel}>
                  Paid on
                </label>
                <input
                  id="paidOn"
                  type="date"
                  max={nowAsDateValue()}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className={styles.formInput}
                />
              </div>
            )}

            <div>
              <label htmlFor="onlineOrOffline" className={styles.formLabel}>
                Payment<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="onlineOrOffline"
                required
                disabled={locked}
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
                disabled={locked}
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          {/* Outside .formGrid so the note gets the full modal width — it
              prints on the invoice PDF above the Terms and Conditions, so
              it's usually a sentence, not a field value. */}
          <div>
            <label htmlFor="invoiceNotes" className={styles.formLabel}>
              Notes (optional)
            </label>
            <textarea
              id="invoiceNotes"
              rows={2}
              disabled={locked}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          {canEditDocument && selectedSalesOrders.length > 0 && billing === "full" && partialsOnSelection.length > 0 && (
            <p className={styles.pageSubtext}>
              Bills the balance: {rupees(orderAfterTax)} less {rupees(alreadyBilled)} already billed on{" "}
              {partialsOnSelection.map((invoice) => invoice.invoiceNoDisplay).join(", ")}.
            </p>
          )}

          {canEditDocument && selectedSalesOrders.length > 0 && (
            <div className={styles.totalsRow}>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total before tax</p>
                <p className={styles.totalsRowValue}>₹{preview.beforeTax.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total tax</p>
                <p className={styles.totalsRowValue}>₹{preview.tax.toFixed(2)}</p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total after tax</p>
                <p className={styles.totalsRowValue}>₹{preview.afterTax.toFixed(2)}</p>
              </div>
            </div>
          )}

          {isIssued && (
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

          {wasDeleted && <p className={styles.formHint}>This invoice is cancelled. Restore it to make changes.</p>}
          {isIssued && !wasDeleted && (
            <p className={styles.formHint}>
              This invoice has been issued, so it can&apos;t be changed. Only its payment status can be updated, or it
              can be cancelled.
            </p>
          )}
          {isDraft && (
            <p className={styles.formHint}>
              Draft: it follows any change to its sales orders and isn&apos;t counted in accounts or shown to the
              client until it&apos;s issued.
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {isEdit && confirming === null && (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirming(isDraft ? "delete" : "cancel")}
                    disabled={status === "saving"}
                    className={`${styles.triggerButtonBase} ${wasDeleted ? styles.restoreTriggerButton : styles.deleteTriggerButton}`}
                  >
                    {isDraft ? "Delete draft" : wasDeleted ? "Restore invoice" : "Cancel invoice"}
                  </button>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => void handlePrint()}
                    disabled={status === "saving" || printing}
                  >
                    {printing ? "Preparing…" : isDraft ? "Print draft" : "Print invoice"}
                  </Button>
                </>
              )}

              {confirming !== null && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>{confirmText[confirming]}</span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirming(null)}
                    disabled={status === "saving"}
                  >
                    Go back
                  </Button>
                  <Button type="button" variant="primary" onClick={handleConfirm} disabled={status === "saving"}>
                    {status === "saving" ? "Saving…" : confirmButton[confirming]}
                  </Button>
                </div>
              )}
            </div>

            {confirming === null && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={onClose}>
                  {wasDeleted ? "Close" : "Cancel"}
                </Button>
                {!wasDeleted && (
                  <Button type="submit" variant={isDraft ? "secondary" : "primary"} disabled={status === "saving"}>
                    {status === "saving" ? "Saving…" : canEditDocument ? "Save draft" : "Save"}
                  </Button>
                )}
                {isDraft && (
                  <Button type="button" variant="primary" onClick={handleIssueClick} disabled={status === "saving"}>
                    Issue invoice
                  </Button>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
