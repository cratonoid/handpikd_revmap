"use client";

// ---------------------------------------------------------------------------
// <HolidayCalendarTab> — the holiday / gifting calendar on /admin/information
// ---------------------------------------------------------------------------
// Twelve month cards, the current month marked, each listing its entries in
// the order they were added. Clicking an entry opens it for editing (and
// deleting); "+" on a card opens a blank entry for that month.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { HolidayEventFormModal } from "@/components/admin/holiday-event-form-modal";
import { PlusIcon } from "@/components/icons";
import {
  MONTH_NAMES,
  addHolidayEvent,
  deleteHolidayEvent,
  fetchHolidayEvents,
  updateHolidayEvent,
  type HolidayEvent,
  type HolidayEventInput,
} from "@/lib/information";
import styles from "@/styles/dashboard.module.css";

// What the modal is open on: an existing entry, or a new one for a month.
type Editing = { event: HolidayEvent } | { month: number } | null;

function sortEvents(events: HolidayEvent[]): HolidayEvent[] {
  return [...events].sort((a, b) => a.month - b.month || a.sortOrder - b.sortOrder || a.id - b.id);
}

export function HolidayCalendarTab() {
  const [events, setEvents] = useState<HolidayEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const currentMonth = new Date().getMonth() + 1;

  useEffect(() => {
    let cancelled = false;
    fetchHolidayEvents()
      .then((data) => {
        if (!cancelled) setEvents(sortEvents(data));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load the holiday calendar");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(input: HolidayEventInput) {
    if (editing && "event" in editing) {
      const saved = await updateHolidayEvent(editing.event.id, input);
      setEvents((prev) => sortEvents(prev.map((event) => (event.id === saved.id ? saved : event))));
    } else {
      const saved = await addHolidayEvent(input);
      setEvents((prev) => sortEvents([...prev, saved]));
    }
  }

  async function handleDelete(id: number) {
    await deleteHolidayEvent(id);
    setEvents((prev) => prev.filter((event) => event.id !== id));
  }

  if (isLoading) return <p className={styles.pageSubtext}>Loading calendar…</p>;
  if (loadError) {
    return (
      <p role="alert" className={styles.formError}>
        {loadError}
      </p>
    );
  }

  return (
    <>
      <div className={styles.holidayToolbar}>
        <p className={styles.holidayToolbarText}>Holidays and gifting occasions through the year.</p>
        <Button type="button" variant="primary" onClick={() => setEditing({ month: currentMonth })}>
          + Add entry
        </Button>
      </div>

      <div className={styles.holidayGrid}>
        {MONTH_NAMES.map((monthName, index) => {
          const month = index + 1;
          const monthEvents = events.filter((event) => event.month === month);
          const isCurrent = month === currentMonth;
          return (
            <section
              key={month}
              aria-labelledby={`holiday-month-${month}`}
              className={`${styles.holidayMonth} ${isCurrent ? styles.holidayMonthCurrent : ""}`}
            >
              <header className={styles.holidayMonthHeader}>
                <h2 id={`holiday-month-${month}`} className={styles.holidayMonthTitle}>
                  {monthName}
                  {isCurrent && <span className={styles.holidayMonthBadge}>This month</span>}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditing({ month })}
                  aria-label={`Add an entry to ${monthName}`}
                  title={`Add to ${monthName}`}
                  className={styles.holidayAddButton}
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </header>

              {monthEvents.length === 0 ? (
                <p className={styles.holidayEmpty}>Nothing added yet.</p>
              ) : (
                <ul className={styles.holidayList}>
                  {monthEvents.map((event) => (
                    <li key={event.id}>
                      <button type="button" onClick={() => setEditing({ event })} className={styles.holidayItem}>
                        <span className={styles.holidayItemName}>{event.name}</span>
                        {event.when && <span className={styles.holidayItemWhen}>{event.when}</span>}
                        {event.note && <span className={styles.holidayItemNote}>{event.note}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <HolidayEventFormModal
          event={"event" in editing ? editing.event : null}
          defaultMonth={"month" in editing ? editing.month : currentMonth}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
