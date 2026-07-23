"use client";

// Hierarchical category filter: clicking a node checks it AND reveals its
// children (if any); un-checking it hides + clears its whole subtree again.
import type { CategoryNode } from "@/lib/products-data";
import { CheckIcon } from "@/components/icons";

export function CategoryFilter({
  nodes,
  checkedIds,
  onToggle,
  depth = 0,
}: {
  nodes: CategoryNode[];
  checkedIds: Set<string>;
  onToggle: (node: CategoryNode) => void;
  depth?: number;
}) {
  return (
    <ul className={depth === 0 ? "flex flex-col gap-0.5" : "mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border pl-4"}>
      {nodes.map((node) => {
        const checked = checkedIds.has(node.id);
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onToggle(node)}
              aria-pressed={checked}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-cream-deep"
            >
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  checked ? "border-charcoal bg-charcoal" : "border-border bg-white"
                }`}
              >
                {checked && <CheckIcon className="h-3 w-3 text-cream" strokeWidth={2.5} />}
              </span>
              <span className={checked ? "font-semibold text-charcoal" : "text-ink"}>{node.label}</span>
            </button>

            {checked && node.children && (
              <CategoryFilter
                nodes={node.children}
                checkedIds={checkedIds}
                onToggle={onToggle}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
