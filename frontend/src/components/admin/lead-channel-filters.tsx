"use client";

// ---------------------------------------------------------------------------
// <LeadChannelFilters> — "Data present" and "Sent status" dropdowns
// ---------------------------------------------------------------------------
// Filters the Leads table by its two WhatsApp / Mail tick-box columns, on
// /admin/database and on a campaign's page. The parent owns the values and
// applies them with matchesChannelFilter (lib/database-contacts.ts).
import { CHANNEL_FILTER_OPTIONS, type ChannelFilter } from "@/lib/database-contacts";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

export type LeadChannelFilterValues = { dataPresent: ChannelFilter; sentStatus: ChannelFilter };

export const NO_CHANNEL_FILTERS: LeadChannelFilterValues = { dataPresent: "all", sentStatus: "all" };

const FILTERS: { key: keyof LeadChannelFilterValues; label: string }[] = [
  { key: "dataPresent", label: "Data present" },
  { key: "sentStatus", label: "Sent status" },
];

export function LeadChannelFilters({
  value,
  onChange,
}: {
  value: LeadChannelFilterValues;
  onChange: (next: LeadChannelFilterValues) => void;
}) {
  return (
    <>
      {FILTERS.map((filter) => (
        <select
          key={filter.key}
          value={value[filter.key]}
          onChange={(event) => onChange({ ...value, [filter.key]: event.target.value as ChannelFilter })}
          aria-label={`Filter by ${filter.label.toLowerCase()}`}
          className={`${styles.formInput} ${emailStyles.campaignFilter}`}
        >
          {CHANNEL_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {filter.label}: {option.label}
            </option>
          ))}
        </select>
      ))}
    </>
  );
}
