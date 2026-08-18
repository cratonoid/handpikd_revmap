"use client";

// ---------------------------------------------------------------------------
// <CategoriesPageClient> — the interactive half of /admin/categories
// ---------------------------------------------------------------------------
// Owns the top-level categories table plus the two popups: the "+ Add new
// category" form (add-category-modal.tsx, creates a new parent row) and the
// hierarchy popup opened by DOUBLE-clicking a row (category-tree-modal.tsx,
// shows that parent's full children/sub-children tree). A single click
// instead toggles an inline preview of that parent's existing children right
// in the table (see `expandedIds`) — reusing the same recursive
// <CategoryTreeNode> the popup uses, just rendered inline instead of in a
// modal. This lets an admin skim what's already under a parent without
// leaving the table, and reserves the heavier popup for the deliberate
// "open and edit" action (adding/deleting nodes via update_category).
//
// Click vs. double-click on the same row is ambiguous at the DOM level — a
// double-click always fires two click events first — so the single-click
// toggle is delayed a beat (see `clickTimeoutRef`) and cancelled if a second
// click arrives in time and turns into a double-click instead. Standard
// disambiguation pattern for this; without it every double-click would also
// flash the inline preview open/closed right before the popup appears.
//
// Category data is fetched from the backend (lib/categories.ts, backed by
// GET/POST /admin/categories/*). Every mutation (add parent, add child
// anywhere in a tree) goes through addCategory and then re-fetches the whole
// tree, since add_category doesn't return the created record.
import { useEffect, useRef, useState, Fragment } from "react";
import { Button } from "@/components/button";
import { AddCategoryModal } from "@/components/admin/add-category-modal";
import { CategoryTreeModal } from "@/components/admin/category-tree-modal";
import { CategoryTreeNode } from "@/components/admin/category-tree-node";
import { ChevronRightIcon } from "@/components/icons";
import {
  addCategory,
  countDescendants,
  deleteCategory,
  fetchCategories,
  findCategoryNode,
  type CategoryNode,
} from "@/lib/categories";
import styles from "@/styles/dashboard.module.css";

// How long to wait for a second click before treating the first as final.
// Comfortably above the OS double-click threshold (~500ms) so a real
// double-click never leaks through as a toggle.
const DOUBLE_CLICK_WINDOW_MS = 250;

export function CategoriesPageClient() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchCategories()
      .then((tree) => {
        if (!cancelled) setCategories(tree);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load categories.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCategory = selectedCategoryId ? findCategoryNode(categories, selectedCategoryId) : null;

  // Shared by both add flows below — add_category doesn't return the
  // created record, so the simplest way to reflect the new node (and any
  // is_parent flip on its parent) is to re-fetch the whole tree.
  async function addCategoryAndRefresh(name: string, parentId: string | null) {
    await addCategory(name, parentId);
    setCategories(await fetchCategories());
  }

  async function handleAddParentCategory(name: string) {
    await addCategoryAndRefresh(name, null);
  }

  async function handleAddChildCategory(parentId: string, name: string) {
    await addCategoryAndRefresh(name, parentId);
  }

  async function handleDeleteCategory(categoryId: string) {
    await deleteCategory(categoryId);
    setCategories(await fetchCategories());
    // The popup's own root category may be the one just deleted — close it
    // rather than leaving it open on a category that no longer exists.
    setSelectedCategoryId((prev) => (prev === categoryId ? null : prev));
  }

  function handleRowClick(category: CategoryNode) {
    if (category.children.length === 0) return;

    // A real double-click fires onClick TWICE (once per click) before
    // onDoubleClick — clear any timeout still pending from the first click
    // before scheduling this one, so the ref always points at the single
    // live timeout. Without this, the first click's timeout gets orphaned
    // (overwritten below, not cancelled) and still fires later even though
    // handleRowDoubleClick clears the ref — silently toggling the inline
    // preview open a beat after the popup opens.
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = setTimeout(() => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(category.id)) {
          next.delete(category.id);
        } else {
          next.add(category.id);
        }
        return next;
      });
      clickTimeoutRef.current = null;
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleRowDoubleClick(category: CategoryNode) {
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    setSelectedCategoryId(category.id);
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Categories</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setAddModalOpen(true)}>
          + Add new category
        </Button>
      </div>

      <div className={styles.tableWrap}>
        {isLoading ? (
          <p className={styles.pageSubtext}>Loading categories…</p>
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
                <th className={styles.tableHeadCell}>Subcategory nodes</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category, index) => {
                const hasChildren = category.children.length > 0;
                const isExpanded = expandedIds.has(category.id);

                return (
                  <Fragment key={category.id}>
                    <tr
                      onClick={() => handleRowClick(category)}
                      onDoubleClick={() => handleRowDoubleClick(category)}
                      className={styles.tableRow}
                      aria-expanded={hasChildren ? isExpanded : undefined}
                      title={
                        hasChildren
                          ? "Click to preview children. Double-click to open and edit."
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
                          {category.name}
                        </span>
                      </td>
                      <td className={styles.tableCell}>{countDescendants(category)}</td>
                    </tr>

                    {hasChildren && isExpanded && (
                      <tr>
                        <td className={`${styles.tableCell} ${styles.tableCellSerial} ${styles.tableDropdownCell}`} />
                        <td colSpan={2} className={styles.tableDropdownCell}>
                          <ul className={styles.treeRoot}>
                            {category.children.map((child) => (
                              <CategoryTreeNode
                                key={child.id}
                                node={child}
                                depth={0}
                                onAddChild={handleAddChildCategory}
                                onDelete={handleDeleteCategory}
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
        {!isLoading && !loadError && categories.length === 0 && (
          <p className={styles.pageSubtext}>No categories yet.</p>
        )}
      </div>

      {selectedCategory && (
        <CategoryTreeModal
          category={selectedCategory}
          onClose={() => setSelectedCategoryId(null)}
          onAddChild={handleAddChildCategory}
          onDelete={handleDeleteCategory}
        />
      )}

      {addModalOpen && <AddCategoryModal onClose={() => setAddModalOpen(false)} onAdd={handleAddParentCategory} />}
    </>
  );
}
