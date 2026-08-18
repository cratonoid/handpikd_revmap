"use client";

// ---------------------------------------------------------------------------
// <AccountsPageClient> — the interactive half of /admin/accounts
// ---------------------------------------------------------------------------
// Three tabs (Overview/P&L, Receivables, GST) over one shared date range,
// following orders-page-client.tsx and invoices-page-client.tsx's .viewToggle
// pattern. Overview is the default since it answers "how did we do" first.
//
// The date range lives HERE rather than in each tab, so switching tabs keeps
// the period you were looking at — the whole point of a global range. It's
// applied on "Apply" rather than on every keystroke: a half-typed year in a
// date input ("0202-08-…") is a valid date as far as the browser is
// concerned, and would otherwise fire a request for a two-thousand-month
// range on the way to the one you wanted.
//
// Each tab fetches its own endpoint, and results are cached per (tab, range)
// in `cache` below so flipping back to an already-loaded tab is instant and
// doesn't re-hit the backend. Changing the range clears the cache, since
// every entry in it was keyed to the old period.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { AccountsOverviewTab } from "@/components/admin/accounts-overview-tab";
import { AccountsReceivablesTab } from "@/components/admin/accounts-receivables-tab";
import { AccountsTaxTab } from "@/components/admin/accounts-tax-tab";
import {
  DATE_RANGE_PRESETS,
  fetchAccountsOverview,
  fetchAccountsReceivables,
  fetchAccountsTaxSummary,
  formatDate,
  resolvePreset,
  type AccountsOverview,
  type AccountsReceivables,
  type AccountsTaxSummary,
  type DateRange,
  type DateRangePresetKey,
} from "@/lib/accounts";
import styles from "@/styles/dashboard.module.css";

type Tab = "overview" | "receivables" | "tax";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview & P&L" },
  { key: "receivables", label: "Receivables" },
  { key: "tax", label: "GST summary" },
];

// One cache entry per tab, remembering which range produced it so a stale
// entry from a previous period is never shown.
type CacheEntry =
  | { tab: "overview"; range: DateRange; data: AccountsOverview }
  | { tab: "receivables"; range: DateRange; data: AccountsReceivables }
  | { tab: "tax"; range: DateRange; data: AccountsTaxSummary };

const DEFAULT_PRESET: Exclude<DateRangePresetKey, "custom"> = "this_fy";

export function AccountsPageClient() {
  const [tab, setTab] = useState<Tab>("overview");

  // The range the tabs actually query. `draft*` are what the inputs hold
  // before Apply — see the note above on why they're separate.
  const [range, setRange] = useState<DateRange>(() => resolvePreset(DEFAULT_PRESET));
  const [preset, setPreset] = useState<DateRangePresetKey>(DEFAULT_PRESET);
  const [draftStart, setDraftStart] = useState(range.startDate);
  const [draftEnd, setDraftEnd] = useState(range.endDate);

  const [cache, setCache] = useState<Partial<Record<Tab, CacheEntry>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the effect after a failure, where nothing
  // else in its dependency list has changed.
  const [reloadToken, setReloadToken] = useState(0);

  // Bumped on every load so a slow response from a range or tab the admin has
  // since moved away from is discarded instead of overwriting the new one.
  const requestRef = useRef(0);

  const entry = cache[tab];
  const isCurrent =
    entry !== undefined && entry.range.startDate === range.startDate && entry.range.endDate === range.endDate;

  // Returns a promise rather than setting state itself, so every setState
  // below lands in a .then/.catch callback. That's both the pattern the other
  // admin tabs use (invoices-tab.tsx) and what react-hooks/set-state-in-effect
  // requires — it rejects state updates reachable synchronously from an
  // effect body, which an async/await version would be.
  const fetchEntry = useCallback((targetTab: Tab, targetRange: DateRange): Promise<CacheEntry> => {
    const { startDate, endDate } = targetRange;
    if (targetTab === "overview") {
      return fetchAccountsOverview(startDate, endDate).then(
        (data): CacheEntry => ({ tab: "overview", range: targetRange, data }),
      );
    }
    if (targetTab === "receivables") {
      return fetchAccountsReceivables(startDate, endDate).then(
        (data): CacheEntry => ({ tab: "receivables", range: targetRange, data }),
      );
    }
    return fetchAccountsTaxSummary(startDate, endDate).then(
      (data): CacheEntry => ({ tab: "tax", range: targetRange, data }),
    );
  }, []);

  useEffect(() => {
    if (isCurrent) return;

    const requestId = ++requestRef.current;
    // Deferred into a microtask rather than set straight from the effect
    // body, the same treatment dashboard-shell.tsx gives its auth check. It
    // still lands before the browser paints, so the spinner isn't late.
    queueMicrotask(() => {
      if (requestId !== requestRef.current) return;
      setLoading(true);
      setError(null);
    });

    fetchEntry(tab, range)
      .then((loaded) => {
        if (requestId !== requestRef.current) return;
        setCache((previous) => ({ ...previous, [loaded.tab]: loaded }));
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (requestId !== requestRef.current) return;
        setError(caught instanceof Error ? caught.message : "Failed to load accounts data");
        setLoading(false);
      });
  }, [tab, range, isCurrent, reloadToken, fetchEntry]);

  function applyPreset(key: Exclude<DateRangePresetKey, "custom">) {
    const next = resolvePreset(key);
    setPreset(key);
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
    setRange(next);
    // Every cached tab was keyed to the old period.
    setCache({});
  }

  function applyCustomRange() {
    if (!draftStart || !draftEnd) return;
    setPreset("custom");
    setRange({ startDate: draftStart, endDate: draftEnd });
    setCache({});
  }

  const rangeIsInverted = Boolean(draftStart && draftEnd && draftStart > draftEnd);
  const draftDiffersFromApplied = draftStart !== range.startDate || draftEnd !== range.endDate;

  const rangeSummary = useMemo(
    () => `${formatDate(range.startDate)} – ${formatDate(range.endDate)}`,
    [range.startDate, range.endDate],
  );

  return (
    <>
      <h1 className={styles.pageHeading}>Accounts</h1>
      <p className={styles.pageSubtext}>
        Revenue, profitability, outstanding payments and GST across a period of your choosing.
      </p>

      {/* ------------------------------------------------------------------
          Global date range — owned by this component, read by every tab
          ------------------------------------------------------------------ */}
      <div className={styles.accountsRangeBar}>
        <div className={styles.accountsPresetRow} role="group" aria-label="Date range presets">
          {DATE_RANGE_PRESETS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => applyPreset(option.key)}
              aria-pressed={preset === option.key}
              className={`${styles.accountsPresetButton} ${
                preset === option.key ? styles.accountsPresetButtonActive : ""
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.accountsRangeInputs}>
          <label className={styles.accountsRangeField}>
            <span className={styles.formLabel}>From</span>
            <input
              type="date"
              className={styles.formInput}
              value={draftStart}
              max={draftEnd || undefined}
              onChange={(event) => setDraftStart(event.target.value)}
            />
          </label>
          <label className={styles.accountsRangeField}>
            <span className={styles.formLabel}>To</span>
            <input
              type="date"
              className={styles.formInput}
              value={draftEnd}
              min={draftStart || undefined}
              onChange={(event) => setDraftEnd(event.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={applyCustomRange}
            disabled={!draftStart || !draftEnd || rangeIsInverted || !draftDiffersFromApplied}
          >
            Apply
          </Button>
        </div>
      </div>

      {rangeIsInverted ? (
        <p className={styles.formError}>The &quot;From&quot; date must not be after the &quot;To&quot; date.</p>
      ) : null}

      <div className={styles.accountsToolbar}>
        <p className={styles.accountsRangeSummary}>
          Showing <strong>{rangeSummary}</strong>
        </p>

        <div className={styles.viewToggle} role="tablist" aria-label="Accounts section">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`${styles.viewToggleButton} ${
                tab === option.key ? styles.viewToggleButtonActive : ""
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Errors replace the body, since a partial figure is worse than none —
          an admin reading "₹0 revenue" from a failed request would act on it. */}
      {error ? (
        <div className={styles.placeholderCard}>
          <p className={styles.placeholderHeading}>Couldn&apos;t load this tab</p>
          <p className={styles.placeholderBlurb}>{error}</p>
          <Button type="button" onClick={() => setReloadToken((token) => token + 1)}>
            Try again
          </Button>
        </div>
      ) : !isCurrent ? (
        <p className={styles.accountsLoading}>{loading ? "Loading…" : "Preparing…"}</p>
      ) : (
        <div className={loading ? styles.accountsStale : undefined} aria-busy={loading}>
          {entry.tab === "overview" ? (
            <AccountsOverviewTab data={entry.data} />
          ) : entry.tab === "receivables" ? (
            <AccountsReceivablesTab data={entry.data} />
          ) : (
            <AccountsTaxTab data={entry.data} />
          )}
        </div>
      )}
    </>
  );
}
