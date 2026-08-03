// ---------------------------------------------------------------------------
// Category tree — backed by GET/POST /admin/categories/* (backend/app/api/routes/categories.py)
// ---------------------------------------------------------------------------
// get_categories returns a flat list (category_id, category_name, parent_id);
// buildTree turns that into the nested CategoryNode shape the UI renders.
// add_category only returns a success message (no created record), so the
// page re-fetches the whole tree after a successful add rather than trying
// to splice a locally-fabricated node into place.
import { apiFetch } from "@/lib/api";

export type CategoryNode = {
  id: string;
  name: string;
  children: CategoryNode[];
};

// Shape returned by the backend's CategoryItem schema.
type CategoryItem = {
  category_id: number;
  category_name: string;
  parent_id: number | null;
};

function buildTree(items: CategoryItem[]): CategoryNode[] {
  const nodesById = new Map<number, CategoryNode>();
  for (const item of items) {
    nodesById.set(item.category_id, { id: String(item.category_id), name: item.category_name, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const item of items) {
    const node = nodesById.get(item.category_id)!;
    const parent = item.parent_id !== null ? nodesById.get(item.parent_id) : undefined;
    (parent ?? { children: roots }).children.push(node);
  }
  return roots;
}

export async function fetchCategories(): Promise<CategoryNode[]> {
  const response = await apiFetch("/admin/categories/get_categories");
  if (!response.ok) {
    throw new Error("Failed to load categories.");
  }

  const items: CategoryItem[] = await response.json();
  return buildTree(items);
}

// Adds a category under `parentId` (null for a new top-level category).
// Throws an Error with a user-facing message on failure.
export async function addCategory(name: string, parentId: string | null): Promise<void> {
  const response = await apiFetch("/admin/categories/add_category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category_name: name,
      parent_id: parentId !== null ? Number(parentId) : null,
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Parent category not found.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}

// Deletes a category. The backend rejects this (409) if the category still
// has child categories or products under it — that rejection reason (from
// the response body's `detail`) is surfaced as-is since it's already a
// clear, user-facing message ("category has child categories" / "category
// has products").
export async function deleteCategory(categoryId: string): Promise<void> {
  const response = await apiFetch("/admin/categories/update_category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: Number(categoryId), delete: true }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Category not found.");
    }
    if (response.status === 409) {
      const body: { detail?: string } = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? "This category can't be deleted.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}

export function findCategoryNode(tree: CategoryNode[], targetId: string): CategoryNode | null {
  for (const current of tree) {
    if (current.id === targetId) return current;
    const found = findCategoryNode(current.children, targetId);
    if (found) return found;
  }
  return null;
}

// Total number of children + grandchildren + ... under a node (not counting
// the node itself) — shown in the table as the "Subcategories" count.
export function countDescendants(node: CategoryNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

export type FlatCategory = { id: string; name: string; depth: number };

// Depth-first flatten of the tree into one list, with each node's nesting
// depth attached — used by the product form's category multiselect
// (components/admin/multi-select-dropdown.tsx), which shows every category
// (parents and leaves alike) as one indented list rather than a nested tree.
export function flattenCategories(tree: CategoryNode[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of tree) {
    result.push({ id: node.id, name: node.name, depth });
    result.push(...flattenCategories(node.children, depth + 1));
  }
  return result;
}

// Looks up display names for a set of category ids, in the order given —
// used to render a product's category chips without re-walking the tree.
export function namesForCategoryIds(flat: FlatCategory[], ids: string[]): string[] {
  const namesById = new Map(flat.map((c) => [c.id, c.name]));
  return ids.map((id) => namesById.get(id) ?? id);
}
