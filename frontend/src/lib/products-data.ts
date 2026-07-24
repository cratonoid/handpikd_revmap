// ---------------------------------------------------------------------------
// Product catalogue: category tree + placeholder product data
// ---------------------------------------------------------------------------
// This file is the "database" for the /products page. Since there's no real
// backend/database yet, everything is generated once, at build/import time,
// from a single hand-written tree (`spec` below) and kept in memory as plain
// arrays that the rest of the app imports and reads.
//
// The big idea in this file: instead of maintaining the CATEGORY TREE (for
// the sidebar filters) and the PRODUCT LIST (for the grid) as two separate,
// easy-to-let-drift-out-of-sync data structures, we maintain ONE tree
// (`spec`) and derive both from it with a recursive function (`walk`, near
// the bottom). That guarantees every product's category path is always
// valid, because it's built from the same tree the filters use.
//
// Source: internal product-category worksheets (Drinkware / Electronics &
// Accessories / Stationery / Bags). Swap prices, names, and images for real
// SKUs once the catalogue is sourced.

// A node in the CATEGORY TREE shown in the sidebar filter
// (see src/components/products/category-filter.tsx). Every node has an id
// and a label; branch nodes additionally have `children`. TypeScript's `?`
// after a property name means it's optional — a leaf category (like
// "Juicer") simply won't have a `children` array at all.
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
  price: number; // current/selling price, in INR (whole rupees, no decimals)
  originalPrice: number; // higher "before discount" price, for the strikethrough
  image: string;
  alt: string;
  /** Category ids from the root down to (and including) the leaf, e.g.
   *  ["drinkware", "mugs", "mugs-steel"]. Used by the filter logic in
   *  products-page-client.tsx to test "does this product belong to any of
   *  the currently-checked categories?" */
  categoryPath: string[];
};

// The shape of ONE entry in the hand-written `spec` tree below. It's
// intentionally more flexible than `CategoryNode` or `Product` — a `Spec`
// node can be a pure category (has `children`, no `product`), a pure
// product (`product` is set, no `children`), but never both at once in this
// data set. `base` is a rough USD reference price that gets converted to a
// realistic INR price further down (see `toInrPrice`).
type Spec = {
  id: string;
  label: string;
  children?: Spec[];
  product?: { name: string; base: number };
};

// -----------------------------------------------------------------------
// THE SOURCE TREE
// -----------------------------------------------------------------------
// This nested array is the one place that encodes the whole catalogue
// structure: 4 top-level categories (Drinkware, Electronics and
// Accessories, Stationery, Bags), each branching down into
// sub-categories, sometimes several levels deep (e.g. Stationery > Pen >
// Metal > "Metal With Cork"). Every id must be unique across the ENTIRE
// tree (not just among siblings) because the filter UI uses ids in a flat
// `Set<string>` to track which categories are checked.
//
// Every node is either:
//   - a BRANCH: has `children`, no `product` — just a folder in the tree.
//   - a LEAF: no `children`, has `product` — an actual thing you can buy.
// The `walk()` function below relies on that split to decide what to do
// with each node.
const spec: Spec[] = [
  {
    id: "drinkware",
    label: "Drinkware",
    children: [
      {
        id: "mugs",
        label: "Mugs",
        children: [
          { id: "mugs-steel", label: "Stainless Steel", product: { name: "Stainless Steel Mug", base: 17 } },
          { id: "mugs-hot-cold", label: "Hot n Cold", product: { name: "Hot & Cold Insulated Mug", base: 19 } },
          { id: "mugs-ceramic", label: "Ceramic", product: { name: "Ceramic Coffee Mug", base: 13 } },
          { id: "mugs-glass", label: "Glass", product: { name: "Glass Mug", base: 12 } },
        ],
      },
      {
        id: "bottles",
        label: "Bottles",
        children: [
          { id: "bottles-steel", label: "Stainless Steel", product: { name: "Stainless Steel Bottle", base: 24 } },
          { id: "bottles-hot-cold", label: "Hot n Cold", product: { name: "Hot & Cold Insulated Bottle", base: 26 } },
          { id: "bottles-plastic", label: "Plastic", product: { name: "Plastic Sports Bottle", base: 12 } },
          { id: "bottles-bamboo", label: "Bamboo", product: { name: "Bamboo Water Bottle", base: 22 } },
        ],
      },
      // A leaf directly under "Drinkware" (no in-between sub-category) —
      // notice it has `product` but no `children`.
      { id: "juicer", label: "Juicer", product: { name: "Portable Juicer", base: 34 } },
    ],
  },
  {
    id: "electronics",
    label: "Electronics and Accessories",
    children: [
      {
        id: "mobile-acc",
        label: "Mobile Accessories",
        children: [
          {
            id: "power-bank",
            label: "Power Bank",
            children: [
              { id: "power-bank-wired", label: "Wired", product: { name: "Wired Power Bank", base: 22 } },
              { id: "power-bank-wireless", label: "Wireless", product: { name: "Wireless Power Bank", base: 28 } },
            ],
          },
          { id: "cable-multi", label: "Cable (Multi)", product: { name: "Multi-Pin Charging Cable", base: 14 } },
          {
            id: "mobile-charger",
            label: "Mobile Charger",
            children: [
              { id: "mobile-charger-cable", label: "With Cable", product: { name: "Mobile Charger with Cable", base: 16 } },
              { id: "mobile-charger-wireless", label: "Wireless Charger", product: { name: "Wireless Mobile Charger", base: 24 } },
            ],
          },
        ],
      },
      {
        id: "laptop-acc",
        label: "Computer/Laptop Accessories",
        children: [
          { id: "mouse", label: "Mouse", product: { name: "Wireless Mouse", base: 19 } },
          { id: "laptop-stand", label: "Laptop Stand", product: { name: "Laptop Stand", base: 32 } },
        ],
      },
      {
        id: "desk-acc",
        label: "Desk Accessories",
        children: [
          { id: "clock", label: "Clock", product: { name: "Desk Clock", base: 21 } },
          { id: "lamp", label: "Lamp", product: { name: "Desk Lamp", base: 27 } },
          {
            id: "pen-stand",
            label: "Pen Stand",
            children: [
              { id: "pen-stand-wood", label: "Wooden", product: { name: "Wooden Pen Stand", base: 15 } },
              { id: "pen-stand-metal", label: "Metal", product: { name: "Metal Pen Stand", base: 18 } },
              { id: "pen-stand-plastic", label: "Plastic", product: { name: "Plastic Pen Stand", base: 9 } },
              { id: "pen-stand-leather", label: "Leather", product: { name: "Leather Pen Stand", base: 22 } },
            ],
          },
          { id: "desk-fan", label: "Desk Fan", product: { name: "Desk Fan", base: 26 } },
          {
            id: "mobile-stand",
            label: "Mobile Stand",
            children: [
              { id: "mobile-stand-plain", label: "Plain", product: { name: "Mobile Stand", base: 11 } },
              { id: "mobile-stand-charger", label: "With Charger", product: { name: "Mobile Stand with Charger", base: 23 } },
            ],
          },
        ],
      },
      {
        id: "other-electronics",
        label: "Other",
        children: [
          { id: "earphones", label: "Earphones", product: { name: "Wireless Earphones", base: 24 } },
          { id: "music-player", label: "Music Player", product: { name: "Portable Music Player", base: 38 } },
          { id: "bt-speaker", label: "Bluetooth Speaker", product: { name: "Bluetooth Speaker", base: 42 } },
        ],
      },
    ],
  },
  {
    id: "stationery",
    label: "Stationery",
    children: [
      {
        id: "pen",
        label: "Pen",
        children: [
          { id: "pen-plastic", label: "Plastic", product: { name: "Plastic Pen", base: 4 } },
          // Four levels deep: Stationery > Pen > Metal > "Metal With Cork".
          {
            id: "pen-metal",
            label: "Metal",
            children: [
              { id: "pen-metal-plain", label: "Plain", product: { name: "Metal Pen", base: 12 } },
              { id: "pen-metal-cork", label: "Metal With Cork", product: { name: "Metal Pen with Cork Grip", base: 15 } },
              { id: "pen-metal-bamboo", label: "Metal With Bamboo", product: { name: "Metal Pen with Bamboo Grip", base: 14 } },
            ],
          },
          { id: "pen-bamboo", label: "Bamboo", product: { name: "Bamboo Pen", base: 7 } },
        ],
      },
      { id: "pencil", label: "Pencil", product: { name: "Wooden Pencil", base: 3 } },
      {
        id: "diary",
        label: "Diary",
        children: [
          { id: "diary-leather", label: "Leather", product: { name: "Leather Diary", base: 26 } },
          { id: "diary-cork", label: "Cork", product: { name: "Cork Cover Diary", base: 18 } },
          { id: "diary-bamboo", label: "Bamboo", product: { name: "Bamboo Cover Diary", base: 20 } },
        ],
      },
      {
        id: "notepad",
        label: "Notepad",
        children: [
          { id: "notepad-plain", label: "Plain", product: { name: "Plain Notepad", base: 6 } },
          { id: "notepad-sticky", label: "Sticky", product: { name: "Sticky Notepad", base: 5 } },
        ],
      },
      {
        id: "id-cards-group",
        label: "ID Cards",
        children: [
          {
            id: "id-cards",
            label: "ID Cards",
            children: [
              { id: "id-cards-pvc", label: "PVC", product: { name: "PVC ID Card", base: 5 } },
              {
                id: "id-cards-cover",
                label: "With Cover",
                children: [
                  { id: "id-cards-cover-leather", label: "Leather", product: { name: "Leather ID Card Holder", base: 9 } },
                  { id: "id-cards-cover-plastic", label: "Plastic", product: { name: "Plastic ID Card Holder", base: 6 } },
                ],
              },
            ],
          },
          {
            id: "sling-hook",
            label: "Sling with Hook",
            children: [
              { id: "sling-hook-neck", label: "Neck", product: { name: "Neck Lanyard", base: 7 } },
              { id: "sling-hook-retractable", label: "Retractable", product: { name: "Retractable ID Badge Reel", base: 9 } },
            ],
          },
        ],
      },
      {
        id: "seminar-file",
        label: "Seminar File",
        children: [
          { id: "seminar-file-plastic", label: "Plastic", product: { name: "Plastic Seminar File", base: 8 } },
          { id: "seminar-file-paper", label: "300 GSM Paper", product: { name: "300 GSM Paper Seminar File", base: 6 } },
        ],
      },
      { id: "calendar", label: "Calendar", product: { name: "Desk Calendar", base: 11 } },
    ],
  },
  {
    id: "bags",
    label: "Bags",
    children: [
      {
        id: "carry-bag",
        label: "Carry Bag",
        children: [
          { id: "carry-bag-cloth", label: "Cloth (Loop)", product: { name: "Cloth Carry Bag", base: 9 } },
          { id: "carry-bag-jute", label: "Jute / Sun Jute", product: { name: "Jute Carry Bag", base: 11 } },
          { id: "carry-bag-paper", label: "Paper (230/300/350 GSM)", product: { name: "Paper Carry Bag", base: 7 } },
        ],
      },
      {
        id: "sleeve",
        label: "Sleeve",
        children: [
          { id: "sleeve-leather", label: "Leather", product: { name: "Leather Laptop Sleeve", base: 24 } },
          { id: "sleeve-fabric", label: "Fabric", product: { name: "Fabric Laptop Sleeve", base: 14 } },
        ],
      },
      {
        id: "office-bag",
        label: "Office Bag",
        children: [
          { id: "office-bag-leather", label: "Leather", product: { name: "Leather Office Bag", base: 68 } },
          { id: "office-bag-fabric", label: "Fabric", product: { name: "Fabric Office Bag", base: 42 } },
        ],
      },
      { id: "backpacks", label: "Backpacks", product: { name: "Corporate Backpack", base: 55 } },
      { id: "duffle-bags", label: "Duffle Bags", product: { name: "Duffle Bag", base: 48 } },
      { id: "sling-bag", label: "Sling Bag", product: { name: "Sling Bag", base: 32 } },
      {
        id: "travel-bag",
        label: "Travel Bag",
        children: [
          { id: "travel-bag-hard", label: "Hard Case", product: { name: "Hard Case Travel Bag", base: 76 } },
          { id: "travel-bag-fabric", label: "Fabric", product: { name: "Fabric Travel Bag", base: 58 } },
        ],
      },
    ],
  },
];

// -----------------------------------------------------------------------
// Pricing helpers
// -----------------------------------------------------------------------
// `base` values above are approximate USD reference points, converted to a
// realistic INR retail price ending in "9" (e.g. ₹1,409), the local
// equivalent of a ".99" price.
const USD_TO_INR = 83;

function toInrPrice(usdBase: number): number {
  const inr = usdBase * USD_TO_INR;
  // Round to the nearest multiple of 10 first (e.g. 1411 -> 1410), THEN
  // subtract 1 to land on a "...9" ending (1410 -> 1409). Doing it in this
  // order (round first, then -1) is what guarantees the result always ends
  // in 9 instead of some other digit.
  const roundedToTen = Math.round(inr / 10) * 10;
  // `Math.max(9, ...)` is a safety floor so a very cheap item can never
  // round down to a price of ₹-1 or ₹0.
  return Math.max(9, roundedToTen - 1);
}

// Formats a number as an Indian Rupee string, e.g. formatInr(12345) ->
// "₹12,345". `toLocaleString("en-IN")` is a built-in JavaScript method that
// knows India's digit-grouping convention (which groups differently from
// the US/UK past the first thousand — e.g. 1,23,456 instead of 123,456),
// so we don't have to hand-write comma-insertion logic ourselves.
export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// Builds one `Product` object for a single leaf in the spec tree.
function makeProduct(id: string, name: string, base: number, categoryPath: string[]): Product {
  const price = toInrPrice(base);
  const originalPrice = toInrPrice(base * 1.28); // ~28% "discount" for the strikethrough price
  return {
    id,
    name,
    price,
    originalPrice,
    // picsum.photos is a free placeholder-image service. Using the same
    // "seed" string every time (here, `handpikd-${id}`) makes it return the
    // SAME image on every visit instead of a random one, so product photos
    // don't change every time the page reloads.
    image: `https://picsum.photos/seed/handpikd-${id}/600/600`,
    alt: `${name} product photo`,
    categoryPath,
  };
}

// -----------------------------------------------------------------------
// The recursive tree walk
// -----------------------------------------------------------------------
// This is the function that turns the single `spec` tree above into the TWO
// things the rest of the app actually needs: a `CategoryNode[]` tree (for
// rendering the filter sidebar) and a flat `Product[]` array (for the grid).
//
// "Recursive" means the function calls ITSELF to handle each nested level.
// If that's a new idea: think of it like Russian nesting dolls — `walk`
// knows how to process one node, and whenever that node has children, it
// asks a fresh call to `walk` to process THOSE children the exact same way,
// no matter how deeply nested they are. The function doesn't need to know
// in advance whether the tree is 2 levels deep or 6 — it keeps calling
// itself until it runs out of children.
//
// `ancestors` is the list of category ids "above" the nodes currently being
// processed (e.g. ["drinkware", "bottles"] when walking Bottles' children).
// Each recursive call adds one more id to that list, which is how every
// product ends up with a full `categoryPath` from root to leaf.
function walk(nodes: Spec[], ancestors: string[]): { tree: CategoryNode[]; products: Product[] } {
  const tree: CategoryNode[] = [];
  const products: Product[] = [];

  for (const node of nodes) {
    // The full path to THIS node = everything above it, plus its own id.
    // `[...ancestors, node.id]` copies the `ancestors` array and appends
    // `node.id` to the end, without mutating the original array (so
    // sibling nodes in this same loop don't accidentally share/corrupt
    // each other's path).
    const path = [...ancestors, node.id];

    if (node.children) {
      // Branch node: recurse into its children first...
      const sub = walk(node.children, path);
      // ...then add this node to the tree, with the CHILDREN'S tree
      // nested inside it...
      tree.push({ id: node.id, label: node.label, children: sub.tree });
      // ...and bubble every product found anywhere below this branch up
      // to the current level's product list. `...sub.products` "spreads"
      // (unpacks) each item out of that array individually, rather than
      // pushing the whole array as one single element.
      products.push(...sub.products);
    } else {
      // Leaf node: just add it to the tree as-is (no children)...
      tree.push({ id: node.id, label: node.label });
      // ...and, if it has product info attached, build a real Product and
      // add it to the flat list.
      if (node.product) {
        products.push(makeProduct(node.id, node.product.name, node.product.base, path));
      }
    }
  }

  return { tree, products };
}

// Run the walk ONCE, starting with an empty ancestor path (`[]`, since the
// top-level categories have no parent). The results are computed once when
// this module first loads and then reused everywhere — nothing below this
// line re-runs `walk` again.
const built = walk(spec, []);

export const categoryTree: CategoryNode[] = built.tree;
export const products: Product[] = built.products;

// Given a category node, returns its own id PLUS every descendant id
// underneath it, flattened into one array. Used by the "uncheck a parent
// category" logic in products-page-client.tsx: when you uncheck
// "Drinkware", this is how the app knows to also un-check "Mugs",
// "Bottles", "Stainless Steel", etc. — everything nested inside it.
// This is also a recursive function, just like `walk` above, but simpler:
// it doesn't need to build two different outputs, just one flat list.
export function collectIds(node: CategoryNode): string[] {
  const ids = [node.id];
  // `?.` (optional chaining) means "only call .forEach if node.children
  // isn't undefined" — skips safely for leaf nodes that have no children.
  node.children?.forEach((child) => ids.push(...collectIds(child)));
  return ids;
}

// The lowest and highest price across ALL products, used to set the
// min/max bounds of the price slider. `.reduce()` walks the whole
// `products` array once, keeping a running "accumulator" (`acc`) that
// starts as `{ min: Infinity, max: 0 }` and updates on every product: the
// running min can only go down (starting from "infinitely high" so the
// very first real price is guaranteed to be lower), and the running max
// can only go up.
export const priceBounds = products.reduce(
  (acc, p) => ({ min: Math.min(acc.min, p.price), max: Math.max(acc.max, p.price) }),
  { min: Infinity, max: 0 },
);
