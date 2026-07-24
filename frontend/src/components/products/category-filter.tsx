"use client";

// ---------------------------------------------------------------------------
// <CategoryFilter> — the recursive, expandable category tree in the sidebar
// ---------------------------------------------------------------------------
// Hierarchical category filter: clicking a node checks it AND reveals its
// children (if any); un-checking it hides + clears its whole subtree again.
//
// This component is RECURSIVE — it renders itself again for each level of
// nested categories. See src/lib/products-data.ts's `walk()` function for
// another example of recursion, with a longer explanation of the concept if
// it's unfamiliar.
//
// Notice this component doesn't hold any state itself (no useState) — the
// actual "which categories are checked" data lives in the PARENT component
// (products-page-client.tsx) and is passed down as the `checkedIds` prop,
// with `onToggle` passed down as the function to call when something
// changes. This pattern (state lives in a parent, children just display it
// and report events upward) is often called "lifting state up," and it's
// what lets the parent also use `checkedIds` to actually filter the product
// grid, not just to control this sidebar.
import type { CategoryNode } from "@/lib/products-data";
import { CheckIcon } from "@/components/icons";

export function CategoryFilter({
  nodes, // the array of categories to render at THIS level (top-level categories on the first call, then a node's own `children` on recursive calls)
  checkedIds, // the full Set of currently-checked category ids, owned by the parent component
  onToggle, // call this when a category row is clicked, passing the node that was clicked
  depth = 0, // how many levels deep this call is nested — 0 for top-level categories, 1 for their children, etc. Used only to control indentation styling below.
}: {
  nodes: CategoryNode[];
  checkedIds: Set<string>;
  onToggle: (node: CategoryNode) => void;
  depth?: number;
}) {
  return (
    // Top-level categories get no extra indent styling; nested levels get a
    // left border + padding so the tree structure is visually obvious.
    <ul className={depth === 0 ? "flex flex-col gap-0.5" : "mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border pl-4"}>
      {nodes.map((node) => {
        // `Set.has()` checks whether this specific node's id is currently
        // in the checked set — a Set is used (rather than an array) because
        // checking membership with `.has()` is much faster than scanning an
        // array with `.includes()`, which matters here since this check
        // runs for every node, at every level, on every render.
        const checked = checkedIds.has(node.id);
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onToggle(node)}
              aria-pressed={checked} // tells assistive tech this button acts like a toggle, and its current on/off state
              className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-cream-deep"
            >
              {/* The custom checkbox square — a plain <span> styled to
                  look like one, rather than a real <input type="checkbox">.
                  A real checkbox isn't used here because the WHOLE ROW
                  needs to be clickable (not just a small checkbox square),
                  and the `<button>` above already handles that plus the
                  correct `aria-pressed` toggle semantics. */}
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

            {/* THE RECURSIVE PART: if this node is checked AND has
                children, render another <CategoryFilter> for just those
                children, one level deeper (`depth + 1`). Because this is
                gated on `checked`, a category's sub-options are completely
                absent from the page (not just visually hidden) until you
                click to check it open — that's what makes checking a
                category feel like it "expands into a dropdown." */}
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
