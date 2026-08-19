"use client";

// ---------------------------------------------------------------------------
// <InquiryFormTreeNode> — one row (+ its subtree) inside the hamper inquiry
// form hierarchy popup (components/admin/inquiry-form-tree-modal.tsx)
// ---------------------------------------------------------------------------
// Renders itself recursively, same idea as category-tree-node.tsx: every
// child in `node.children` becomes another <InquiryFormTreeNode> one level
// deeper, so the tree goes to whatever depth the admin has built (category ->
// item -> brand option -> ...). Unlike the plain category tree, each node
// here carries extra form-builder config (minimum amount, prompt, selection
// mode, max selections, active/inactive) — editing that opens <InquiryNodeFormModal>
// pre-filled with the node's current values, rather than an inline text
// input, since there are too many fields to fit inline.
import { useState } from "react";
import { Button } from "@/components/button";
import { InquiryNodeFormModal } from "@/components/admin/inquiry-node-form-modal";
import type { InquiryNodeFormValues, InquiryTreeNode } from "@/lib/inquiry-form";
import { formatInr } from "@/lib/public-products";
import { ChevronRightIcon, PenIcon, PlusIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

function selectionSummary(node: InquiryTreeNode): string {
  if (node.selectionMode === "single") return "Sub-options: pick one";
  return node.maxSelections !== null ? `Sub-options: up to ${node.maxSelections}` : "Sub-options: multi-select";
}

export function InquiryFormTreeNode({
  node,
  depth,
  onAddChild,
  onUpdate,
  onDelete,
}: {
  node: InquiryTreeNode;
  depth: number;
  onAddChild: (parentId: number, values: InquiryNodeFormValues) => Promise<void>;
  onUpdate: (nodeId: number, values: InquiryNodeFormValues) => Promise<void>;
  onDelete: (nodeId: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasChildren = node.children.length > 0;

  async function handleConfirmDelete() {
    setDeleteStatus("deleting");
    setDeleteError(null);
    try {
      await onDelete(node.id);
      // On success this node unmounts (removed from the parent's re-fetched
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

          <span
            className={depth === 0 ? styles.treeNodeNameRoot : styles.treeNodeName}
            title={hasChildren ? selectionSummary(node) : undefined}
          >
            {node.label}
            {node.minAmount !== null && (
              <span className={styles.treeNodeNote}>(min {formatInr(node.minAmount)})</span>
            )}
            {!node.isActive && <span className={styles.inactiveBadge}>Inactive</span>}
          </span>
        </div>

        <div className={styles.treeNodeActions}>
          {hasChildren && (
            <span className={styles.treeNodeCount} title={selectionSummary(node)}>
              {node.children.length}
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setEditOpen(true);
              setAddOpen(false);
              setConfirmingDelete(false);
            }}
            aria-label={`Edit ${node.label}`}
            className={styles.treeAddButton}
          >
            <PenIcon className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setAddOpen((prev) => !prev);
              setEditOpen(false);
              setConfirmingDelete(false);
              setDeleteError(null);
            }}
            aria-label={`Add sub-option under ${node.label}`}
            aria-expanded={addOpen}
            className={styles.treeAddButton}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setConfirmingDelete((prev) => !prev);
              setDeleteError(null);
              setAddOpen(false);
              setEditOpen(false);
            }}
            aria-label={`Delete ${node.label}`}
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
              ? `"${node.label}" has sub-options and can't be deleted until they're removed.`
              : `Delete "${node.label}"? This can't be undone.`}
          </span>
          {!hasChildren && (
            <Button
              type="button"
              variant="tertiary"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleteStatus === "deleting"}
            >
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

      {hasChildren && expanded && (
        <ul className={styles.treeChildren}>
          {node.children.map((child) => (
            <InquiryFormTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onAddChild={onAddChild}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {addOpen && (
        <InquiryNodeFormModal
          mode="add"
          title={`Add sub-option under "${node.label}"`}
          onClose={() => setAddOpen(false)}
          onSubmit={async (values) => {
            await onAddChild(node.id, values);
            setAddOpen(false);
            setExpanded(true);
          }}
        />
      )}

      {editOpen && (
        <InquiryNodeFormModal
          mode="edit"
          title={`Edit "${node.label}"`}
          initialValues={{
            label: node.label,
            minAmount: node.minAmount !== null ? String(node.minAmount) : "",
            prompt: node.prompt ?? "",
            selectionMode: node.selectionMode,
            maxSelections: node.maxSelections !== null ? String(node.maxSelections) : "",
            sortOrder: node.sortOrder,
            isActive: node.isActive,
          }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (values) => {
            await onUpdate(node.id, values);
            setEditOpen(false);
          }}
        />
      )}
    </li>
  );
}
