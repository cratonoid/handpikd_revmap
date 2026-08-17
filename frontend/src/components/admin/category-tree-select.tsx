"use client";

// ---------------------------------------------------------------------------
// <CategoryTreeSelect> — the recursive, expand-on-check category picker used
// by the admin product form's "Categories" field
// ---------------------------------------------------------------------------
// Same idea as components/products/category-filter.tsx and
// components/hamper-inquiry/inquiry-tree-selector.tsx: checking a category
// reveals its children right underneath it, one level at a time (a child's
// own children only show up once IT is clicked too); unchecking clears its
// whole subtree so re-checking later starts collapsed again.
//
// Lives in the same Power BI-style dropdown shell as
// multi-select-dropdown.tsx (trigger button with chips + a panel below), but
// the panel shows a drill-down tree instead of one flat searchable list —
// each category is its own independent selection now, rather than the old
// flat multiselect's behavior of a parent pick auto-selecting its whole
// subtree.
import { useEffect, useMemo, useRef, useState } from "react";
import { descendantIdsById, flattenCategories, type CategoryNode } from "@/lib/categories";
import { ChevronRightIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function CategoryTreeSelect({
  label,
  placeholder = "Select categories",
  tree,
  selectedValues,
  onChange,
}: {
  label: string;
  placeholder?: string;
  tree: CategoryNode[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const namesById = useMemo(() => new Map(flattenCategories(tree).map((c) => [c.id, c.name])), [tree]);
  const descendantsById = useMemo(() => descendantIdsById(tree), [tree]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

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

  function toggleNode(nodeId: string) {
    if (selectedSet.has(nodeId)) {
      const subtree = new Set([nodeId, ...(descendantsById.get(nodeId) ?? [])]);
      onChange(selectedValues.filter((v) => !subtree.has(v)));
    } else {
      onChange([...selectedValues, nodeId]);
    }
  }

  function removeChip(value: string, event: React.MouseEvent) {
    event.stopPropagation();
    toggleNode(value);
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
              {namesById.get(value) ?? value}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Remove ${namesById.get(value) ?? value}`}
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
          <div className={styles.selectList}>
            {tree.length === 0 ? (
              <p className={styles.selectEmpty}>No categories yet.</p>
            ) : (
              <CategoryTreeOptions nodes={tree} selectedSet={selectedSet} onToggle={toggleNode} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// THE RECURSIVE PART: renders itself again for each level of checked
// categories — see category-filter.tsx / inquiry-tree-selector.tsx for the
// same pattern elsewhere in the app.
function CategoryTreeOptions({
  nodes,
  selectedSet,
  onToggle,
  depth = 0,
}: {
  nodes: CategoryNode[];
  selectedSet: Set<string>;
  onToggle: (nodeId: string) => void;
  depth?: number;
}) {
  return (
    <div className={depth === 0 ? undefined : styles.categoryTreeNested}>
      {nodes.map((node) => {
        const checked = selectedSet.has(node.id);
        return (
          <div key={node.id}>
            <div
              role="option"
              aria-selected={checked}
              onClick={() => onToggle(node.id)}
              className={`${styles.selectOption} ${checked ? styles.selectOptionSelected : ""}`}
            >
              <input type="checkbox" readOnly checked={checked} className={styles.selectCheckbox} />
              {node.name}
            </div>

            {checked && node.children.length > 0 && (
              <CategoryTreeOptions nodes={node.children} selectedSet={selectedSet} onToggle={onToggle} depth={depth + 1} />
            )}
          </div>
        );
      })}
    </div>
  );
}