// ---------------------------------------------------------------------------
// Hamper inquiry form — backed by GET/POST /inquiry-form/* (public) and
// /admin/inquiry-form/* (backend/app/api/routes/inquiry_form.py)
// ---------------------------------------------------------------------------
// The hierarchy (category -> item -> brand option -> ...) is one
// self-referencing tree, same shape as lib/categories.ts's Category tree,
// with extra per-node fields describing how THAT node's own children get
// presented/selected: `prompt` (the heading shown above the children when
// picking among them), `selectionMode`/`maxSelections` (single-pick vs
// multi-pick with an optional cap). Top-level nodes have no parent node to
// carry that config, so the first step (picking categories) is always
// implicitly multi/unlimited - see the public form page for where that's
// hardcoded.
//
// `minAmount` is the one field that describes the node ITSELF rather than its
// children: an optional minimum spend per hamper, in rupees. The public form
// adds it up across everything the visitor has checked (see
// collectSelectedMinAmounts below) and shows the running total before they
// submit.
import { apiFetch } from "@/lib/api";

type InquiryFormNodeApiItem = {
  id: number;
  parent_id: number | null;
  label: string;
  min_amount: number | null;
  prompt: string | null;
  selection_mode: "single" | "multi";
  max_selections: number | null;
  sort_order: number;
  is_active: boolean;
};

export type InquiryTreeNode = {
  id: number;
  label: string;
  minAmount: number | null;
  prompt: string | null;
  selectionMode: "single" | "multi";
  maxSelections: number | null;
  sortOrder: number;
  isActive: boolean;
  children: InquiryTreeNode[];
};

function buildTree(items: InquiryFormNodeApiItem[]): InquiryTreeNode[] {
  const nodesById = new Map<number, InquiryTreeNode>();
  for (const item of items) {
    nodesById.set(item.id, {
      id: item.id,
      label: item.label,
      minAmount: item.min_amount,
      prompt: item.prompt,
      selectionMode: item.selection_mode,
      maxSelections: item.max_selections,
      sortOrder: item.sort_order,
      isActive: item.is_active,
      children: [],
    });
  }

  const roots: InquiryTreeNode[] = [];
  for (const item of items) {
    const node = nodesById.get(item.id)!;
    const parent = item.parent_id !== null ? nodesById.get(item.parent_id) : undefined;
    (parent ?? { children: roots }).children.push(node);
  }

  function sortSubtree(nodes: InquiryTreeNode[]) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    nodes.forEach((node) => sortSubtree(node.children));
  }
  sortSubtree(roots);

  return roots;
}

export function findInquiryNode(tree: InquiryTreeNode[], id: number): InquiryTreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findInquiryNode(node.children, id);
    if (found) return found;
  }
  return null;
}

// Every descendant's id (children, grandchildren, ...) under a node - used so
// unchecking a node also clears whatever was picked within its subtree.
export function collectDescendantIds(node: InquiryTreeNode): number[] {
  const ids: number[] = [];
  for (const child of node.children) {
    ids.push(child.id, ...collectDescendantIds(child));
  }
  return ids;
}

// Every checked node that carries a `minAmount`, in the order it appears in
// the tree, each tagged with the labels of the checked ancestors it sits
// under ("Electronics" -> "Headphone") so the form can show the visitor a
// breakdown of exactly where their running minimum comes from.
export type MinAmountLine = {
  id: number;
  label: string;
  path: string[]; // checked ancestor labels, outermost first
  minAmount: number;
};

export function collectSelectedMinAmounts(
  nodes: InquiryTreeNode[],
  selectedIds: Set<number>,
  path: string[] = [],
): MinAmountLine[] {
  const lines: MinAmountLine[] = [];
  for (const node of nodes) {
    if (!selectedIds.has(node.id)) continue;
    if (node.minAmount !== null) {
      lines.push({ id: node.id, label: node.label, path, minAmount: node.minAmount });
    }
    lines.push(...collectSelectedMinAmounts(node.children, selectedIds, [...path, node.label]));
  }
  return lines;
}

export function sumMinAmounts(lines: MinAmountLine[]): number {
  return lines.reduce((total, line) => total + line.minAmount, 0);
}

// ---------------------------------------------------------------------------
// Public (visitor-facing) endpoints
// ---------------------------------------------------------------------------
export async function fetchPublicInquiryFormTree(): Promise<InquiryTreeNode[]> {
  const response = await apiFetch("/inquiry-form/get_nodes");
  if (!response.ok) {
    throw new Error("Couldn't load the inquiry form. Please refresh and try again.");
  }
  const items: InquiryFormNodeApiItem[] = await response.json();
  return buildTree(items);
}

export type HamperInquirySubmission = {
  firmName: string;
  occasion: string;
  itemQuantity: number;
  budgetPerItem: number;
  selectedNodeIds: number[];
};

export async function submitHamperInquiry(data: HamperInquirySubmission): Promise<void> {
  const response = await apiFetch("/inquiry-form/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firm_name: data.firmName,
      occasion: data.occasion,
      item_quantity: data.itemQuantity,
      budget_per_item: data.budgetPerItem,
      selected_node_ids: data.selectedNodeIds,
    }),
  });

  if (!response.ok) {
    const body: { detail?: string } = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "Something went wrong submitting your inquiry. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Admin endpoints - hierarchy editing
// ---------------------------------------------------------------------------
export async function fetchAdminInquiryFormTree(): Promise<InquiryTreeNode[]> {
  const response = await apiFetch("/admin/inquiry-form/get_nodes");
  if (!response.ok) {
    throw new Error("Failed to load the inquiry form hierarchy.");
  }
  const items: InquiryFormNodeApiItem[] = await response.json();
  return buildTree(items);
}

export type InquiryNodeFormValues = {
  label: string;
  minAmount: string; // numeric input value as a string; "" means no minimum
  prompt: string;
  selectionMode: "single" | "multi";
  maxSelections: string; // numeric input value as a string; "" means no cap
  sortOrder: number;
  isActive: boolean;
};

export async function addInquiryFormNode(parentId: number | null, values: InquiryNodeFormValues): Promise<void> {
  const response = await apiFetch("/admin/inquiry-form/add_node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parent_id: parentId,
      label: values.label.trim(),
      min_amount: values.minAmount.trim() ? Number(values.minAmount) : null,
      prompt: values.prompt.trim() || null,
      selection_mode: values.selectionMode,
      max_selections: values.maxSelections.trim() ? Number(values.maxSelections) : null,
      sort_order: values.sortOrder,
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Parent option not found.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}

export async function updateInquiryFormNode(nodeId: number, values: InquiryNodeFormValues): Promise<void> {
  const response = await apiFetch("/admin/inquiry-form/update_node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_id: nodeId,
      label: values.label.trim(),
      min_amount: values.minAmount.trim() ? Number(values.minAmount) : null,
      prompt: values.prompt.trim() || null,
      selection_mode: values.selectionMode,
      max_selections: values.maxSelections.trim() ? Number(values.maxSelections) : null,
      sort_order: values.sortOrder,
      is_active: values.isActive,
    }),
  });

  if (!response.ok) {
    throw new Error("Something went wrong. Please try again.");
  }
}

// Deletes an option. The backend rejects this (409) if it still has
// sub-options under it - that rejection reason is surfaced as-is.
export async function deleteInquiryFormNode(nodeId: number): Promise<void> {
  const response = await apiFetch("/admin/inquiry-form/update_node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ node_id: nodeId, delete: true }),
  });

  if (!response.ok) {
    if (response.status === 409) {
      const body: { detail?: string } = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? "This option can't be deleted.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Admin endpoints - viewing submissions
// ---------------------------------------------------------------------------
export type InquirySubmissionSelection = {
  nodeId: number;
  parentId: number | null;
  label: string;
  minAmount: number | null;
};

export type InquirySubmission = {
  id: number;
  firmName: string;
  occasion: string;
  itemQuantity: number;
  budgetPerItem: number;
  createdAt: string;
  totalMinAmount: number;
  selections: InquirySubmissionSelection[];
};

type InquiryFormSubmissionApiItem = {
  id: number;
  firm_name: string;
  occasion: string;
  item_quantity: number;
  budget_per_item: number;
  created_at: string;
  total_min_amount: number;
  selections: { node_id: number; parent_id: number | null; label: string; min_amount: number | null }[];
};

export async function fetchInquirySubmissions(): Promise<InquirySubmission[]> {
  const response = await apiFetch("/admin/inquiry-form/get_submissions");
  if (!response.ok) {
    throw new Error("Failed to load submissions.");
  }
  const items: InquiryFormSubmissionApiItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    firmName: item.firm_name,
    occasion: item.occasion,
    itemQuantity: item.item_quantity,
    budgetPerItem: item.budget_per_item,
    createdAt: item.created_at,
    totalMinAmount: item.total_min_amount,
    selections: item.selections.map((sel) => ({
      nodeId: sel.node_id,
      parentId: sel.parent_id,
      label: sel.label,
      minAmount: sel.min_amount,
    })),
  }));
}

// Groups a submission's flat, snapshotted `selections` back into a tree for
// display - independent of the live hierarchy (which may have since changed)
// since every selection already carries its own label/minAmount/parent_id.
export type SubmissionSelectionNode = InquirySubmissionSelection & { children: SubmissionSelectionNode[] };

export function buildSubmissionSelectionTree(selections: InquirySubmissionSelection[]): SubmissionSelectionNode[] {
  const nodesById = new Map<number, SubmissionSelectionNode>();
  for (const sel of selections) {
    nodesById.set(sel.nodeId, { ...sel, children: [] });
  }

  const roots: SubmissionSelectionNode[] = [];
  for (const sel of selections) {
    const node = nodesById.get(sel.nodeId)!;
    const parent = sel.parentId !== null ? nodesById.get(sel.parentId) : undefined;
    (parent ?? { children: roots }).children.push(node);
  }
  return roots;
}
