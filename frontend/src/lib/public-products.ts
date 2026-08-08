// ---------------------------------------------------------------------------
// Public (unauthenticated) storefront data for the /products page
// ---------------------------------------------------------------------------
// Mirrors lib/catalogues.ts's public section. Backed by GET
// /products/get_public_products and GET /products/get_public_categories
// (backend/app/api/routes/products.py's public_router) — separate from every
// admin-only endpoint in lib/products.ts, which needs a Bearer token and
// exposes admin-only fields (hsn_code, vendor_id, gst_perc, ...).
import { apiFetch, resolveMediaUrl } from "@/lib/api";

// A node in the CATEGORY TREE shown in the sidebar filter
// (see src/components/products/category-filter.tsx).
export type CategoryNode = {
  id: string;
  label: string;
  children?: CategoryNode[];
};

// A single purchasable item shown in the product grid
// (see src/components/products/product-card.tsx).
export type Product = {
  id: string;
  name: string;
  price: number; // ProductDetails.discounted_price
  originalPrice: number; // ProductDetails.actual_price, for the strikethrough
  image: string;
  alt: string;
  // Category ids this product is directly tagged with — NOT a full
  // root-to-leaf ancestor path (unlike the old mock data's categoryPath).
  // Matching "does this product belong to a checked category" therefore
  // needs to expand the checked id into its own id + every descendant id
  // first — see buildDescendantIndex below.
  categoryIds: string[];
};

type PublicCategoryNodeResponse = {
  id: number;
  name: string;
  children: PublicCategoryNodeResponse[];
};

type PublicProductItemResponse = {
  id: number;
  product_name: string;
  price: number;
  original_price: number;
  category_ids: number[];
  image_paths: string[];
};

// picsum.photos is a free placeholder-image service, used only as a fallback
// for a product that (unexpectedly) has no images saved yet.
const PLACEHOLDER_IMAGE = "https://picsum.photos/seed/handpikd-placeholder/600/600";

function mapCategoryNode(node: PublicCategoryNodeResponse): CategoryNode {
  return {
    id: String(node.id),
    label: node.name,
    ...(node.children.length > 0 ? { children: node.children.map(mapCategoryNode) } : {}),
  };
}

export async function fetchPublicCategories(): Promise<CategoryNode[]> {
  const response = await apiFetch("/products/get_public_categories");
  if (!response.ok) {
    throw new Error("Failed to load categories");
  }

  const items: PublicCategoryNodeResponse[] = await response.json();
  return items.map(mapCategoryNode);
}

export async function fetchPublicProducts(): Promise<Product[]> {
  const response = await apiFetch("/products/get_public_products");
  if (!response.ok) {
    throw new Error("Failed to load products");
  }

  const items: PublicProductItemResponse[] = await response.json();
  return items.map((item) => ({
    id: String(item.id),
    name: item.product_name,
    price: item.price,
    originalPrice: item.original_price,
    image: item.image_paths[0] ? resolveMediaUrl(item.image_paths[0]) : PLACEHOLDER_IMAGE,
    alt: `${item.product_name} product photo`,
    categoryIds: item.category_ids.map(String),
  }));
}

// Given a category node, returns its own id PLUS every descendant id
// underneath it, flattened into one array. Used both by the "uncheck a
// parent category" logic in products-page-client.tsx (unchecking "Drinkware"
// also un-checks "Mugs", "Bottles", etc.) and by buildDescendantIndex below.
export function collectIds(node: CategoryNode): string[] {
  const ids = [node.id];
  node.children?.forEach((child) => ids.push(...collectIds(child)));
  return ids;
}

function indexNodesById(nodes: CategoryNode[], nodesById: Map<string, CategoryNode>): void {
  for (const node of nodes) {
    nodesById.set(node.id, node);
    if (node.children) indexNodesById(node.children, nodesById);
  }
}

// Maps every category id in the tree to its own id + all descendant ids.
// Since a product is tagged with specific category ids (not a full
// ancestor path), checking a PARENT category in the sidebar needs to match
// every product tagged anywhere in that parent's subtree — this map is what
// lets products-page-client.tsx expand a checked id into the full set of
// tags it should match against.
export function buildDescendantIndex(tree: CategoryNode[]): Map<string, string[]> {
  const nodesById = new Map<string, CategoryNode>();
  indexNodesById(tree, nodesById);

  const index = new Map<string, string[]>();
  for (const [id, node] of nodesById) {
    index.set(id, collectIds(node));
  }
  return index;
}

// Formats a number as an Indian Rupee string, e.g. formatInr(12345) ->
// "₹12,345".
export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}
