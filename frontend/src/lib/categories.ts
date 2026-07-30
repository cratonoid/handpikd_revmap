// ---------------------------------------------------------------------------
// Category tree — backed by GET/POST /admin/categories/* (backend/app/api/routes/categories.py)
// ---------------------------------------------------------------------------
// get_categories returns a flat list (id, category_name, parent_id, is_parent);
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
  id: number;
  category_name: string;
  parent_id: number | null;
  is_parent: boolean;
};

function buildTree(items: CategoryItem[]): CategoryNode[] {
  const nodesById = new Map<number, CategoryNode>();
  for (const item of items) {
    nodesById.set(item.id, { id: String(item.id), name: item.category_name, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const item of items) {
    const node = nodesById.get(item.id)!;
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
