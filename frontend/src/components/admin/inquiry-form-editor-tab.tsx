"use client";

// ---------------------------------------------------------------------------
// <InquiryFormEditorTab> — the "Form builder" half of /admin/inquiry-form
// ---------------------------------------------------------------------------
// Mirrors categories-page-client.tsx closely: a top-level table of the
// categories a visitor sees first on the public form, with the same
// click-to-preview / double-click-to-edit split (see DOUBLE_CLICK_WINDOW_MS
// below for why single vs. double click needs disambiguating). The "+ Add
// new category" button creates a new top-level node; everything below a
// top-level category (items, brand options, ...) is added/edited/deleted
// through the popup opened by double-clicking a row.
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { InquiryNodeFormModal } from "@/components/admin/inquiry-node-form-modal";
import { InquiryFormTreeModal } from "@/components/admin/inquiry-form-tree-modal";
import { InquiryFormTreeNode } from "@/components/admin/inquiry-form-tree-node";
import { ChevronRightIcon } from "@/components/icons";
import {
  addInquiryFormNode,
  deleteInquiryFormNode,
  fetchAdminInquiryFormTree,
  findInquiryNode,
  updateInquiryFormNode,
  type InquiryNodeFormValues,
  type InquiryTreeNode,
} from "@/lib/inquiry-form";
import styles from "@/styles/dashboard.module.css";

// How long to wait for a second click before treating the first as final —
// see categories-page-client.tsx for the full rationale (a real double-click
// always fires onClick twice before onDoubleClick).
const DOUBLE_CLICK_WINDOW_MS = 250;

export function InquiryFormEditorTab() {
  const [tree, setTree] = useState<InquiryTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addRootOpen, setAddRootOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchAdminInquiryFormTree()
      .then((result) => {
        if (!cancelled) setTree(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load the hierarchy.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNode = selectedId !== null ? findInquiryNode(tree, selectedId) : null;

  async function refresh() {
    setTree(await fetchAdminInquiryFormTree());
  }

  async function handleAddChild(parentId: number, values: InquiryNodeFormValues) {
    await addInquiryFormNode(parentId, values);
    await refresh();
  }

  async function handleUpdate(nodeId: number, values: InquiryNodeFormValues) {
    await updateInquiryFormNode(nodeId, values);
    await refresh();
  }

  async function handleDelete(nodeId: number) {
    await deleteInquiryFormNode(nodeId);
    await refresh();
    setSelectedId((prev) => (prev === nodeId ? null : prev));
  }

  function handleRowClick(node: InquiryTreeNode) {
    if (node.children.length === 0) return;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = setTimeout(() => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      clickTimeoutRef.current = null;
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleRowDoubleClick(node: InquiryTreeNode) {
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    setSelectedId(node.id);
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div className={styles.modalActionsRight}>
          <Button type="button" variant="primary" onClick={() => setAddRootOpen(true)}>
            + Add new category
          </Button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        {isLoading ? (
          <p className={styles.pageSubtext}>Loading…</p>
        ) : loadError ? (
          <p role="alert" className={styles.formError}>
            {loadError}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.tableHeadCell} ${styles.tableHeadCellSerial}`}>S.No</th>
                <th className={`${styles.tableHeadCell} ${styles.tableHeadCellTight}`}>Category</th>
                <th className={styles.tableHeadCell}>Sub-options</th>
                <th className={styles.tableHeadCell}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tree.map((node, index) => {
                const hasChildren = node.children.length > 0;
                const isExpanded = expandedIds.has(node.id);

                return (
                  <Fragment key={node.id}>
                    <tr
                      onClick={() => handleRowClick(node)}
                      onDoubleClick={() => handleRowDoubleClick(node)}
                      className={styles.tableRow}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      title={
                        hasChildren
                          ? "Click to preview sub-options. Double-click to open and edit."
                          : "Double-click to open and edit."
                      }
                    >
                      <td className={`${styles.tableCell} ${styles.tableCellSerial}`}>{index + 1}</td>
                      <td className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.tableCellTight}`}>
                        <span className={styles.tableCategoryName}>
                          {hasChildren && (
                            <ChevronRightIcon
                              className={`h-3.5 w-3.5 ${styles.tableChevron} ${
                                isExpanded ? styles.tableChevronOpen : ""
                              }`}
                            />
                          )}
                          {node.label}
                        </span>
                      </td>
                      <td className={styles.tableCell}>{node.children.length}</td>
                      <td className={styles.tableCell}>{node.isActive ? "Active" : "Inactive"}</td>
                    </tr>

                    {hasChildren && isExpanded && (
                      <tr>
                        <td className={`${styles.tableCell} ${styles.tableCellSerial} ${styles.tableDropdownCell}`} />
                        <td colSpan={3} className={styles.tableDropdownCell}>
                          <ul className={styles.treeRoot}>
                            {node.children.map((child) => (
                              <InquiryFormTreeNode
                                key={child.id}
                                node={child}
                                depth={0}
                                onAddChild={handleAddChild}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                              />
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {!isLoading && !loadError && tree.length === 0 && <p className={styles.pageSubtext}>No categories yet.</p>}
      </div>

      {selectedNode && (
        <InquiryFormTreeModal
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          onAddChild={handleAddChild}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}

      {addRootOpen && (
        <InquiryNodeFormModal
          mode="add"
          title="Add new category"
          onClose={() => setAddRootOpen(false)}
          onSubmit={async (values) => {
            await addInquiryFormNode(null, values);
            await refresh();
            setAddRootOpen(false);
          }}
        />
      )}
    </>
  );
}
