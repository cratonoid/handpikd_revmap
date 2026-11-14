"use client";

// ---------------------------------------------------------------------------
// <InformationPageClient> — /admin/information
// ---------------------------------------------------------------------------
// Reference material for the team. Laid out as tabs (same pill as
// inventory-page-client.tsx) so more pages can be added beside the holiday
// calendar later; with one tab the pill simply names what's on screen.
import { useState } from "react";
import { HolidayCalendarTab } from "@/components/admin/holiday-calendar-tab";
import styles from "@/styles/dashboard.module.css";

type Tab = "holidays";

const TABS: { value: Tab; label: string }[] = [{ value: "holidays", label: "Holiday calendar" }];

export function InformationPageClient() {
  const [tab, setTab] = useState<Tab>("holidays");

  return (
    <>
      <div className={styles.pageHeaderWithTabs}>
        <h1 className={styles.pageHeading}>Information</h1>
        <div className={styles.viewToggle} role="tablist" aria-label="Information section">
          {TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
              className={`${styles.viewToggleButton} ${tab === option.value ? styles.viewToggleButtonActive : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "holidays" && <HolidayCalendarTab />}
    </>
  );
}
