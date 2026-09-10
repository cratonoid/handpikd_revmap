"use client";

// ---------------------------------------------------------------------------
// <TableSearchInput> — the search box above a data table
// ---------------------------------------------------------------------------
// Filters rows that are ALREADY in the browser: every admin table fetches
// its list whole on mount, so searching is a filter over that array rather
// than a query the backend has to answer. Nothing is re-fetched and nothing
// is debounced — there is no request to debounce, and results land on the
// keystroke.
//
// Pairs with matchesSearch below, which is what each table uses to decide
// whether a row is a hit. The two live together so a table can't drift into
// its own matching rules.
import { MagnifyingGlassIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function TableSearchInput({
  value,
  onChange,
  label,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  // What the box searches, e.g. "Search inventory". There is no visible
  // label above it — the row it sits in is a strip of controls, not a form —
  // so this is what a screen reader announces.
  label: string;
  placeholder?: string;
}) {
  return (
    <div className={styles.tableSearch}>
      <MagnifyingGlassIcon className={styles.tableSearchIcon} />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={styles.tableSearchInput}
      />
      {/* Only once there is something to clear, so the box isn't carrying a
          dead button the whole time it sits empty. */}
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className={styles.tableSearchClear}
        >
          <XMarkIcon className={styles.tableSearchClearIcon} />
        </button>
      )}
    </div>
  );
}

// True when every whitespace-separated term in `query` appears somewhere in
// `fields`. All terms rather than any, so typing more narrows the list
// instead of widening it — and across the joined fields rather than within
// one, so "mug 4501" finds the mug whose HSN is 4501 even though neither
// field contains both.
//
// Numbers are accepted so a caller can pass a quantity or an order number
// without stringifying it at every call site; empty/missing fields drop out
// rather than joining as "undefined", which would otherwise be matchable.
export function matchesSearch(query: string, fields: (string | number | null | undefined)[]): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = fields
    .filter((field) => field !== null && field !== undefined && field !== "")
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}
