"use client";

// ---------------------------------------------------------------------------
// <NewTicketModal> — raise a ticket (client portal, or the team on a
// client's behalf)
// ---------------------------------------------------------------------------
// Passing `clients` adds the "Client" picker, which is the team's version.
// A client raises tickets only for themselves, so the portal leaves it out
// and the backend takes the client from the login.
import { useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { SingleSelectDropdown } from "@/components/admin/single-select-dropdown";
import { customerLabel, type CustomerOption } from "@/lib/customers";
import type { TicketDetail } from "@/lib/tickets";
import styles from "@/styles/dashboard.module.css";

export function NewTicketModal({
  clients,
  onCreate,
  onCreated,
  onClose,
}: {
  clients?: CustomerOption[];
  onCreate: (custId: number | null, subject: string, message: string) => Promise<TicketDetail>;
  onCreated: (detail: TicketDetail) => void;
  onClose: () => void;
}) {
  const [custId, setCustId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onCreated(await onCreate(custId ? Number(custId) : null, subject.trim(), message.trim()));
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
