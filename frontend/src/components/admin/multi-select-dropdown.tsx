"use client";

// ---------------------------------------------------------------------------
// <MultiSelectDropdown> — Power BI-style multiselect filter control
// ---------------------------------------------------------------------------
// Used by product-form-modal.tsx for picking a product's categories, where
// `options` is the flattened category tree (lib/categories.ts'
// flattenCategories) so parent AND child categories are all individually
// selectable, indented to show hierarchy.
//
// Selections apply immediately as each checkbox is clicked (no separate
// "Apply" button) — closer to a live filter than a form field with a commit
// step, which keeps this control consistent with every other input on the
// form. "Select all" only affects whatever the search box currently has
// visible, matching how Power BI's own slicer search + select-all interact.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export type MultiSelectOption = { value: string; label: string; depth?: number };

export function MultiSelectDropdown({
  label,
  placeholder = "Select…",
  options,
  selectedValues,
  onChange,
}: {
  label: string;
  placeholder?: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const labelsByValue = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const allFilteredSelected =
    filteredOptions.length > 0 && filteredOptions.every((o) => selectedSet.has(o.value));

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

  function toggleValue(value: string) {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
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

  function removeChip(value: string, event: React.MouseEvent) {
    event.stopPropagation();
    onChange(selectedValues.filter((v) => v !== value));
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
        {selectedValues.length === 0 ? (
          <span className={styles.selectPlaceholder}>{placeholder}</span>
        ) : (
          selectedValues.map((value) => (
            <span key={value} className={styles.selectChip}>
              {labelsByValue.get(value) ?? value}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Remove ${labelsByValue.get(value) ?? value}`}
                onClick={(e) => removeChip(value, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    removeChip(value, e as unknown as React.MouseEvent);
                  }
                }}
                className={styles.selectChipRemove}
              >
                <XMarkIcon className="h-3 w-3" />
              </span>
            </span>
          ))
        )}
        <ChevronRightIcon
          className={`h-3.5 w-3.5 ${styles.selectTriggerChevron} ${open ? styles.selectTriggerChevronOpen : ""}`}
        />
      </button>

      {open && (
        <div role="listbox" aria-multiselectable="true" className={styles.selectPanel}>
          <input
            type="text"
            autoFocus
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.selectSearchInput}
          />

          <div role="option" aria-selected={allFilteredSelected} className={styles.selectAllRow} onClick={toggleSelectAllFiltered}>
            <input
              type="checkbox"
              readOnly
              checked={allFilteredSelected}
              className={styles.selectCheckbox}
            />
            Select all{search.trim() && " (filtered)"}
          </div>

          <div className={styles.selectList}>
            {filteredOptions.length === 0 && <p className={styles.selectEmpty}>No categories match.</p>}
            {filteredOptions.map((option) => {
              const isSelected = selectedSet.has(option.value);
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggleValue(option.value)}
                  style={{ paddingLeft: `${0.85 + (option.depth ?? 0) * 1.1}rem` }}
                  className={`${styles.selectOption} ${isSelected ? styles.selectOptionSelected : ""}`}
                >
                  <input type="checkbox" readOnly checked={isSelected} className={styles.selectCheckbox} />
                  {option.label}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
