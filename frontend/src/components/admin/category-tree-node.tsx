"use client";

// ---------------------------------------------------------------------------
// <CategoryTreeNode> — one row (+ its subtree) inside the category hierarchy
// popup (components/admin/category-tree-modal.tsx)
// ---------------------------------------------------------------------------
// Renders itself recursively: every child in `node.children` is rendered as
// another <CategoryTreeNode> one level deeper. This is what lets the tree go
// to unlimited depth — there's no hardcoded "parent/child/sub-child" ceiling.
//
// Kept collapsed below the top level by default (see `defaultExpanded`)
// because the category tree can get very wide/deep — an admin opening a
// popup to a wall of fully-expanded nodes would be worse than one they can
// drill into on demand.
//
// The "+" button toggles a small inline add-child form right under the row
// (rather than a separate modal) so adding a sibling stays close to the
// node it belongs to, however deep in the tree that is. `onAddChild` calls
// POST /admin/categories/add_category (see lib/categories.ts) and throws on
// failure, which is shown inline instead of collapsing the form.
//
// The "x" button works the same way but with a confirm step first, since
// deletion is a hard delete with no undo. `onDelete` calls
// POST /admin/categories/update_category, which the backend rejects (409)
// if this category still has child categories or products under it — that
// rejection reason is what ends up in the thrown Error and gets shown here.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import type { CategoryNode } from "@/lib/categories";
import { ChevronRightIcon, PlusIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

export function CategoryTreeNode({
  node,
  depth,
  onAddChild,
  onDelete,
}: {
  node: CategoryNode;
  depth: number;
  onAddChild: (parentId: string, name: string) => Promise<void>;
  onDelete: (categoryId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasChildren = node.children.length > 0;

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = childName.trim();
    if (!trimmed) return;

    setStatus("saving");
    setError(null);
    try {
      await onAddChild(node.id, trimmed);
      setChildName("");
      setAddingChild(false);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  async function handleConfirmDelete() {
    setDeleteStatus("deleting");
    setDeleteError(null);
    try {
      await onDelete(node.id);
      // On success this node unmounts (removed from the parent's fetched
      // tree), so there's no local state left to reset.
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setDeleteStatus("idle");
    }
  }

  return (
    <li className={styles.treeNode}>
      <div className={styles.treeNodeRow}>
        <div className={styles.treeNodeMain}>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            disabled={!hasChildren}
            aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
            className={styles.treeToggleButton}
          >
            {hasChildren && (
              <ChevronRightIcon className={`h-3.5 w-3.5 ${expanded ? styles.treeToggleIconOpen : ""}`} />
            )}
          </button>

          <span className={depth === 0 ? styles.treeNodeNameRoot : styles.treeNodeName}>{node.name}</span>
        </div>

        <div className={styles.treeNodeActions}>
          {hasChildren && <span className={styles.treeNodeCount}>{node.children.length}</span>}

          <button
            type="button"
            onClick={() => {
              setAddingChild((prev) => !prev);
              setError(null);
              setConfirmingDelete(false);
              setDeleteError(null);
            }}
            aria-label={`Add category under ${node.name}`}
            aria-expanded={addingChild}
            className={styles.treeAddButton}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setConfirmingDelete((prev) => !prev);
              setDeleteError(null);
              setAddingChild(false);
              setError(null);
            }}
            aria-label={`Delete ${node.name}`}
            aria-expanded={confirmingDelete}
            className={styles.treeDeleteButton}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div className={styles.treeDeleteConfirmRow}>
          <span className={styles.deleteConfirmText}>
            {hasChildren
              ? `"${node.name}" has subcategories and can't be deleted until they're removed.`
              : `Delete "${node.name}"? This can't be undone.`}
          </span>
          {!hasChildren && (
            <Button type="button" variant="tertiary" onClick={() => setConfirmingDelete(false)} disabled={deleteStatus === "deleting"}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={hasChildren ? () => setConfirmingDelete(false) : handleConfirmDelete}
            disabled={deleteStatus === "deleting"}
          >
            {hasChildren ? "Okay" : deleteStatus === "deleting" ? "Deleting…" : "Yes, delete"}
          </Button>
          {deleteError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {deleteError}
            </p>
          )}
        </div>
      )}

      {addingChild && (
        <form onSubmit={handleAddSubmit} className={styles.treeAddForm}>
          <input
            type="text"
            autoFocus
            required
            placeholder={`New category under "${node.name}"`}
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            className={styles.treeAddInput}
            aria-label={`New category name under ${node.name}`}
            disabled={status === "saving"}
          />
          <button type="submit" className={styles.treeAddConfirmButton} disabled={status === "saving"}>
            {status === "saving" ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingChild(false);
              setChildName("");
              setError(null);
            }}
            className={styles.treeAddCancelButton}
            disabled={status === "saving"}
          >
            Cancel
          </button>
          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}
        </form>
      )}

      {hasChildren && expanded && (
        <ul className={styles.treeChildren}>
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
