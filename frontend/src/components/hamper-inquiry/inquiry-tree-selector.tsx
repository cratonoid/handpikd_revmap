"use client";

// ---------------------------------------------------------------------------
// <InquiryTreeSelector> — the recursive, expand-on-check hierarchy picker
// used by the hamper inquiry form's "selection" step
// ---------------------------------------------------------------------------
// Renders itself again for every level of the admin-configured hierarchy
// (category -> item -> brand option -> ...), same recursive-expand idea as
// components/products/category-filter.tsx: checking a node reveals its
// children right underneath it; unchecking clears its whole subtree.
//
// What differs from that simpler filter is that here EVERY node can carry
// its own presentation config for its children (lib/inquiry-form.ts):
// `selectionMode` ("single" picks like a radio group, "multi" like
// checkboxes), an optional `maxSelections` cap, and a `prompt` heading — plus
// its own optional `minAmount`, shown next to the label here and added into
// the running total the form keeps underneath this tree. The
// component doesn't hold state itself — `selectedIds` (the full set of
// checked node ids, across every level) lives in the parent form component,
// with `onToggle` called to report a change; see hamper-inquiry-form-client.tsx
// for how single-select/cap enforcement is applied there.
import type { InquiryTreeNode } from "@/lib/inquiry-form";
import { formatInr } from "@/lib/public-products";
import { CheckIcon } from "@/components/icons";
import styles from "@/styles/hamper-inquiry.module.css";

export function InquiryTreeSelector({
  nodes, // the nodes to render at THIS level (top-level categories on the first call, then a checked node's own `children` on recursive calls)
  selectionMode, // how these particular siblings are picked
  maxSelections, // cap on picks among these siblings, when selectionMode === "multi"
  heading, // text shown above this level's list
  selectedIds, // full Set of every checked node id, across every level, owned by the parent form
  onToggle,
  depth = 0,
}: {
  nodes: InquiryTreeNode[];
  selectionMode: "single" | "multi";
  maxSelections: number | null;
  heading?: string | null;
  selectedIds: Set<number>;
  onToggle: (node: InquiryTreeNode, siblings: InquiryTreeNode[], selectionMode: "single" | "multi", maxSelections: number | null) => void;
  depth?: number;
}) {
  if (nodes.length === 0) return null;

  const checkedSiblingCount = nodes.filter((node) => selectedIds.has(node.id)).length;
  const atCap = selectionMode === "multi" && maxSelections !== null && checkedSiblingCount >= maxSelections;

  return (
    <div className={depth === 0 ? styles.selectionBlock : undefined}>
      {heading && (
        <>
          <p className={styles.selectionHeading}>{heading}</p>
          {selectionMode === "multi" && maxSelections !== null && (
            <p className={styles.selectionHint}>Select up to {maxSelections}.</p>
          )}
          {selectionMode === "single" && <p className={styles.selectionHint}>Choose one.</p>}
        </>
      )}

      <div className={depth === 0 ? styles.optionList : styles.optionListNested}>
        {nodes.map((node) => {
          const checked = selectedIds.has(node.id);
          const disabled = !checked && atCap;

          return (
            <div key={node.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(node, nodes, selectionMode, maxSelections)}
                aria-pressed={checked}
                className={`${styles.optionRow} ${checked ? styles.optionRowChecked : ""} ${
                  disabled ? styles.optionRowDisabled : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`${styles.optionCheckbox} ${
                    selectionMode === "single" ? styles.optionCheckboxRound : styles.optionCheckboxSquare
                  } ${checked ? styles.optionCheckboxChecked : ""}`}
                >
                  {checked && <CheckIcon className="h-3 w-3" strokeWidth={2.5} />}
                </span>
                <span className={styles.optionLabel}>
                  {node.label}
                  {node.minAmount !== null && (
                    <span className={styles.optionNote}> · min {formatInr(node.minAmount)}</span>
                  )}
                </span>
              </button>

              {checked && node.children.length > 0 && (
                <InquiryTreeSelector
                  nodes={node.children}
                  selectionMode={node.selectionMode}
                  maxSelections={node.maxSelections}
                  heading={node.prompt ?? "Select all that apply:"}
                  selectedIds={selectedIds}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
