"use client";

// ---------------------------------------------------------------------------
// <StatusSelect> — the status dropdown inside a table row
// ---------------------------------------------------------------------------
// Lets a status be changed from the list itself instead of opening the row's
// edit form for the one field. Used by the Status column of the sales orders
// table (components/admin/sales-orders-tab.tsx) and the sales invoices table
// (components/admin/invoices-tab.tsx).
//
// Deliberately dumb: it renders the control and reports the pick. Saving,
// the optimistic update and the rollback belong to the table, because what a
// status change costs differs — an order's move into "Delivered" moves
// stock and can be refused, an invoice's move to "Paid" cannot.
//
// It carries no color of its own either. The cell around it holds the status
// color class, and the select inherits it, which is what keeps the colored
// word looking the same as it did before it became a dropdown — including
// inverting with the rest of the row on hover.
import styles from "@/styles/dashboard.module.css";

export function StatusSelect<T extends string | number>({
  value,
  options,
  label,
  disabled = false,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  // What this dropdown sets, said in full for a screen reader — the column
  // header alone doesn't say which row it belongs to. e.g. "Status for
  // order 14".
  label: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  // A value the options don't cover — a since-removed order status, say. The
  // cell rendered "—" for it before it became a dropdown, and still does,
  // rather than sitting empty as an unmatched <select> otherwise would.
  const isKnown = options.some((option) => option.value === value);

  return (
    <span className={styles.statusSelectWrap}>
      <select
        value={String(value)}
        aria-label={label}
        disabled={disabled}
        // Stopped from bubbling so using the dropdown doesn't also count
        // towards the row's double-click-to-edit.
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          // Matched back to the option rather than cast: the DOM hands back
          // a string, and T is just as often a number.
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
        className={styles.statusSelect}
      >
        {!isKnown && <option value={String(value)}>—</option>}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
