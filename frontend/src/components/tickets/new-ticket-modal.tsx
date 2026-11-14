"use client";

// ---------------------------------------------------------------------------
// <NewTicketModal> — raise a ticket (client portal, or the team on a
// client's behalf)
// ---------------------------------------------------------------------------
// Passing `clients` adds the "Client" picker, which is the team's version.
// A client raises tickets only for themselves, so the portal leaves it out
// and the backend takes the client from the login.
//
// "Related order" is optional and lists only that client's own orders: on
// the team's form it fills in once a client is picked. The backend checks
// the order belongs to the client either way.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { SingleSelectDropdown } from "@/components/admin/single-select-dropdown";
import { formatCurrency } from "@/lib/accounts";
import { customerLabel, type CustomerOption } from "@/lib/customers";
import { formatDate } from "@/lib/format-date";
import type { TicketDetail, TicketOrderOption } from "@/lib/tickets";
import styles from "@/styles/dashboard.module.css";

// The picker can't be cleared, so "no order" is an option of its own.
const NO_ORDER = "";

function orderLabel(order: TicketOrderOption): string {
  return `Order #${order.orderNo} · ${formatDate(order.date)} · ${formatCurrency(order.totalAmountAfterTax)}`;
}

export function NewTicketModal({
  clients,
  onCreate,
  loadOrders,
  onCreated,
  onClose,
}: {
  clients?: CustomerOption[];
  onCreate: (
    custId: number | null,
    subject: string,
    message: string,
    salesOrderId: number | null,
  ) => Promise<TicketDetail>;
  loadOrders: (custId: number | null) => Promise<TicketOrderOption[]>;
  onCreated: (detail: TicketDetail) => void;
  onClose: () => void;
}) {
  const [custId, setCustId] = useState<string | null>(null);
  const [orders, setOrders] = useState<TicketOrderOption[] | null>(null);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [orderId, setOrderId] = useState<string>(NO_ORDER);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The team's form has no orders to show until a client is picked. Picking
  // another client drops the previous client's order.
  const needsClient = Boolean(clients) && !custId;
  useEffect(() => {
    if (needsClient) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOrders(null);
      setOrdersFailed(false);
      setOrderId(NO_ORDER);
    });
    loadOrders(custId ? Number(custId) : null)
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch(() => {
        if (!cancelled) {
          setOrders([]);
          setOrdersFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [custId, needsClient, loadOrders]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (clients && !custId) {
      setError("Please choose the client this ticket is for.");
      return;
    }
    if (!subject.trim() || !message.trim()) {
      setError("Please fill in both the subject and the message.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      onCreated(
        await onCreate(
          custId ? Number(custId) : null,
          subject.trim(),
          message.trim(),
          orderId === NO_ORDER ? null : Number(orderId),
        ),
      );
    } catch (failure) {
      setError((failure as Error).message || "Couldn't raise the ticket. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="new-ticket-title" className={styles.modalTitle}>
            {clients ? "Raise a ticket for a client" : "Raise a ticket"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            {clients && (
              <div className={styles.formGridFullSpan}>
                <SingleSelectDropdown
                  label="Client"
                  placeholder="Select a client…"
                  entityLabel="clients"
                  required
                  showStatusFilter={false}
                  options={clients
                    .filter((client) => !client.isDeleted)
                    .map((client) => ({ value: String(client.id), label: customerLabel(client), isDeleted: false }))}
                  selectedValue={custId}
                  onChange={setCustId}
                />
              </div>
            )}

            <div className={styles.formGridFullSpan}>
              {needsClient ? (
                <>
                  <span className={styles.formLabel}>Related order</span>
                  <p className={styles.formStaticValue}>Choose the client first.</p>
                </>
              ) : orders === null ? (
                <>
                  <span className={styles.formLabel}>Related order</span>
                  <p className={styles.formStaticValue}>Loading orders…</p>
                </>
              ) : (
                <SingleSelectDropdown
                  // Remount per client, so the search box starts empty.
                  key={custId ?? "self"}
                  label="Related order"
                  placeholder="No specific order"
                  entityLabel="orders"
                  showStatusFilter={false}
                  options={[
                    { value: NO_ORDER, label: "No specific order", isDeleted: false },
                    ...orders.map((order) => ({ value: String(order.id), label: orderLabel(order), isDeleted: false })),
                  ]}
                  selectedValue={orderId}
                  onChange={setOrderId}
                />
              )}
              {ordersFailed && (
                <p className={styles.formError}>Couldn&apos;t load orders. You can still raise the ticket without one.</p>
              )}
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="ticket-subject" className={styles.formLabel}>
                Subject<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="ticket-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                placeholder="e.g. Hamper delivery delayed"
                className={styles.formInput}
                autoFocus={!clients}
              />
            </div>

            <div className={styles.formGridFullSpan}>
              <label htmlFor="ticket-message" className={styles.formLabel}>
                Message<span className={styles.requiredMark}>*</span>
              </label>
              <textarea
                id="ticket-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={6}
                maxLength={10000}
                placeholder="Describe the issue. Include order or invoice numbers if you have them."
                className={styles.formTextarea}
              />
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
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Raising…" : "Raise ticket"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
