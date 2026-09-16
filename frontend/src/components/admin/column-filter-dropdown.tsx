"use client";

// ---------------------------------------------------------------------------
// <ColumnFilterDropdown> — funnel button + multiselect panel in a table header
// ---------------------------------------------------------------------------
// The "filter this column" control that sits beside a column label
// (currently the Customer column of components/admin/sales-orders-tab.tsx).
// It is the same checkbox-list-with-search idea as multi-select-dropdown.tsx,
// cut down for a header: no trigger with chips (there is no room for chips
// on a header line — the count beside the funnel stands in for them), and
// no tree semantics.
//
// The panel is rendered through a portal onto <body>, position: fixed,
// placed from the funnel's bounding rect — rather than absolute inside the
// header like .selectPanel's default. Two reasons. A sticky <th> sits inside
// .tableWrap, which scrolls (overflow: auto) and so clips anything
// absolutely positioned that hangs below it — with only a few rows in the
// table the panel would be cut off at the table's bottom edge. And every
// sticky header cell is its own stacking context (z-index: 1), so a panel
// kept inside the Customer cell would be painted over by the Status cell
// and the rest to its right. Leaving the table's DOM entirely sidesteps
// both. The trade-off is that the panel doesn't follow the header if the
// page scrolls underneath it, so it closes on scroll and resize instead of
// drifting.
//
// Selections apply as each checkbox is clicked, like the form multiselect;
// an empty selection means "no filter" rather than "match nothing".
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FunnelIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export type ColumnFilterOption = {
  value: number;
  label: string;
};

const PANEL_WIDTH_PX = 260;

export function ColumnFilterDropdown({
  label,
  searchPlaceholder = "Search…",
  emptyMessage = "Nothing matches.",
  options,
  selectedValues,
  onChange,
}: {
  // What the funnel filters, e.g. "Filter by customer" — the button has no
  // visible text, so this is what a screen reader announces.
  label: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  options: ColumnFilterOption[];
  selectedValues: number[];
  onChange: (values: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [panelPosition, setPanelPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const allFilteredSelected = filteredOptions.length > 0 && filteredOptions.every((o) => selectedSet.has(o.value));

  function openPanel() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Hangs off the funnel's left edge, unless that would run the panel
    // past the right of the viewport, in which case it is pulled back in.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH_PX - 8));
    setPanelPosition({ top: rect.bottom + 6, left });
    setSearch("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    // The panel is portalled, so it is NOT inside the wrapper in the DOM —
    // both have to be checked for a click to count as "inside".
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    // Capture phase so a scroll of .tableWrap (which doesn't bubble) is
    // seen too. Scrolling the option list inside the panel is the one
    // scroll that must NOT close it.
    function handleScroll(event: Event) {
      if (panelRef.current && panelRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  function toggleValue(value: number) {
    onChange(selectedSet.has(value) ? selectedValues.filter((v) => v !== value) : [...selectedValues, value]);
  }

  function toggleSelectAllFiltered() {
    const filteredValues = filteredOptions.map((o) => o.value);
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredValues);
      onChange(selectedValues.filter((v) => !filteredSet.has(v)));
    } else {
      onChange([...new Set([...selectedValues, ...filteredValues])]);
    }
  }

  const count = selectedValues.length;

  return (
    <span ref={wrapperRef} className={styles.tableHeadControls}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={count === 0 ? label : `${label} (${count} selected)`}
        title={label}
        className={`${styles.tableHeadButton} ${count > 0 ? styles.tableHeadButtonActive : ""}`}
      >
        <FunnelIcon className={styles.tableHeadFilterIcon} />
      </button>
      {/* How many are picked — the header has no room for a chip per name. */}
      {count > 0 && <span className={styles.tableHeadFilterCount}>{count}</span>}

      {open &&
        panelPosition &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            style={{
              top: panelPosition.top,
              left: panelPosition.left,
              width: PANEL_WIDTH_PX,
            }}
            className={`${styles.selectPanel} ${styles.columnFilterPanel}`}
          >
            <input
              type="text"
              autoFocus
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.selectSearchInput}
            />

            <div
              role="option"
              aria-selected={allFilteredSelected}
              className={styles.selectAllRow}
              onClick={toggleSelectAllFiltered}
            >
              <input type="checkbox" readOnly checked={allFilteredSelected} className={styles.selectCheckbox} />
              Select all{search.trim() && " (filtered)"}
            </div>

            <div className={styles.selectList}>
              {filteredOptions.length === 0 && <p className={styles.selectEmpty}>{emptyMessage}</p>}
              {filteredOptions.map((option) => {
                const isSelected = selectedSet.has(option.value);
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggleValue(option.value)}
                    className={`${styles.selectOption} ${isSelected ? styles.selectOptionSelected : ""}`}
                  >
                    <input type="checkbox" readOnly checked={isSelected} className={styles.selectCheckbox} />
                    {option.label}
                  </div>
                );
              })}
            </div>

            {count > 0 && (
              <button type="button" onClick={() => onChange([])} className={styles.columnFilterClear}>
                Clear filter
              </button>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
