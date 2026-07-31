"use client";

// ---------------------------------------------------------------------------
// <SingleSelectDropdown> — searchable single-pick dropdown
// ---------------------------------------------------------------------------
// Used by product-form-modal.tsx for picking a product's vendor. Vendors
// (lib/vendors.ts) can be soft-deleted, so the panel splits them into an
// Active/Deleted toggle (mirroring the Active/Deleted view on /admin/vendors
// itself) rather than mixing both into one list — an admin editing an older
// product whose vendor has since been deleted can still find and re-confirm
// it under "Deleted" instead of it just vanishing from the picker.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export type SingleSelectOption = { value: string; label: string; isDeleted: boolean };

export function SingleSelectDropdown({
  label,
  placeholder = "Select…",
  options,
  selectedValue,
  onChange,
}: {
  label: string;
  placeholder?: string;
  options: SingleSelectOption[];
  selectedValue: string | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Defaults to whichever group the currently selected option belongs to, so
  // opening the picker on an already-deleted vendor doesn't land on an empty
  // "Active" list.
  const [group, setGroup] = useState<"active" | "deleted">(() => {
    const current = options.find((o) => o.value === selectedValue);
    return current?.isDeleted ? "deleted" : "active";
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === selectedValue) ?? null;

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return options.filter(
      (o) => o.isDeleted === (group === "deleted") && (!term || o.label.toLowerCase().includes(term)),
    );
  }, [options, search, group]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectOption(value: string) {
    onChange(value);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={wrapperRef} className={styles.selectWrapper}>
      <span className={styles.formLabel}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`${styles.selectTrigger} ${open ? styles.selectTriggerOpen : ""}`}
      >
        {selectedOption ? (
          <span className={styles.selectSingleValue}>
            {selectedOption.label}
            {selectedOption.isDeleted && " (deleted)"}
          </span>
        ) : (
          <span className={styles.selectPlaceholder}>{placeholder}</span>
        )}
        <ChevronRightIcon
          className={`h-3.5 w-3.5 ${styles.selectTriggerChevron} ${open ? styles.selectTriggerChevronOpen : ""}`}
        />
      </button>

      {open && (
        <div role="listbox" className={styles.selectPanel}>
          <input
            type="text"
            autoFocus
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.selectSearchInput}
          />

          <div className={styles.selectToggleRow} role="tablist" aria-label="Vendor status">
            <button
              type="button"
              role="tab"
              aria-selected={group === "active"}
              onClick={() => setGroup("active")}
              className={`${styles.selectToggleButton} ${group === "active" ? styles.selectToggleButtonActive : ""}`}
            >
              Active
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={group === "deleted"}
              onClick={() => setGroup("deleted")}
              className={`${styles.selectToggleButton} ${group === "deleted" ? styles.selectToggleButtonActive : ""}`}
            >
              Deleted
            </button>
          </div>

          <div className={styles.selectList}>
            {filteredOptions.length === 0 && <p className={styles.selectEmpty}>No {group} vendors match.</p>}
            {filteredOptions.map((option) => (
              <div
                key={option.value}
                role="option"
                aria-selected={option.value === selectedValue}
                onClick={() => selectOption(option.value)}
                className={`${styles.selectOption} ${option.value === selectedValue ? styles.selectOptionSelected : ""}`}
              >
                {option.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
