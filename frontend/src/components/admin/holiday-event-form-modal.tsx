"use client";

// ---------------------------------------------------------------------------
// <HolidayEventFormModal> — add / edit / delete one holiday calendar entry
// (components/admin/holiday-calendar-tab.tsx)
// ---------------------------------------------------------------------------
// onSave / onDelete throw on failure; the message is shown here and the
// modal stays open.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { MONTH_NAMES, type HolidayEvent, type HolidayEventInput } from "@/lib/information";
import styles from "@/styles/dashboard.module.css";

export function HolidayEventFormModal({
  event,
  defaultMonth,
  onClose,
  onSave,
  onDelete,
}: {
  event: HolidayEvent | null;
  defaultMonth: number;
  onClose: () => void;
  onSave: (input: HolidayEventInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [month, setMonth] = useState(event?.month ?? defaultMonth);
  const [name, setName] = useState(event?.name ?? "");
  const [when, setWhen] = useState(event?.when ?? "");
  const [note, setNote] = useState(event?.note ?? "");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setStatus("saving");
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!name.trim()) return;
    void run(() => onSave({ month, name: name.trim(), when: when.trim(), note: note.trim() }));
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="holiday-event-modal-title"
        className={styles.modalPanel}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="holiday-event-modal-title" className={styles.modalTitle}>
            {event ? "Edit calendar entry" : "Add calendar entry"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label htmlFor="holidayMonth" className={styles.formLabel}>
                Month<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="holidayMonth"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={styles.formInput}
              >
                {MONTH_NAMES.map((monthName, index) => (
                  <option key={monthName} value={index + 1}>
                    {monthName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="holidayWhen" className={styles.formLabel}>
                Date
              </label>
              <input
                id="holidayWhen"
                type="text"
                maxLength={100}
                placeholder="e.g. 14th, 3rd Sunday, varies"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="holidayName" className={styles.formLabel}>
                Occasion<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="holidayName"
                type="text"
                autoFocus
                required
                maxLength={200}
                placeholder="e.g. Diwali"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.formInput}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="holidayNote" className={styles.formLabel}>
                Note
              </label>
              <input
                id="holidayNote"
                type="text"
                maxLength={500}
                placeholder="e.g. the biggest corporate gifting season"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {event && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete entry
                </button>
              )}
              {event && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>Delete this entry?</span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={status === "saving"}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void run(() => onDelete(event.id))}
                    disabled={status === "saving"}
                  >
                    {status === "saving" ? "Deleting…" : "Yes, delete"}
                  </Button>
                </div>
              )}
            </div>

            {!confirmingDelete && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={onClose} disabled={status === "saving"}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={status === "saving"}>
                  {status === "saving" ? "Saving…" : event ? "Save" : "Add entry"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
