// Product catalogue taxonomy + placeholder product data.
// Source: internal product-category worksheets (Drinkware / Electronics &
// Accessories / Stationery / Bags). Swap prices, names, and images for real
// SKUs once the catalogue is sourced.

export type CategoryNode = {
  id: string;
  label: string;
  children?: CategoryNode[];
};

export type Product = {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  image: string;
  alt: string;
  /** Category ids from the root down to (and including) the leaf. */
  categoryPath: string[];
};

type Spec = {
  id: string;
  label: string;
  children?: Spec[];
  product?: { name: string; base: number };
};

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

/** Rounds to a ".99"-ending price near n (e.g. 17 -> 16.99). */
function endsIn99(n: number): number {
  return Number((Math.max(1, Math.round(n) - 1) + 0.99).toFixed(2));
}

function makeProduct(id: string, name: string, base: number, categoryPath: string[]): Product {
  const price = endsIn99(base);
  const originalPrice = endsIn99(base * 1.28);
  return {
    id,
    name,
    price,
    originalPrice,
    image: `https://picsum.photos/seed/handpikd-${id}/600/600`,
    alt: `${name} product photo`,
    categoryPath,
  };
}

function walk(nodes: Spec[], ancestors: string[]): { tree: CategoryNode[]; products: Product[] } {
  const tree: CategoryNode[] = [];
  const products: Product[] = [];

  for (const node of nodes) {
    const path = [...ancestors, node.id];

    if (node.children) {
      const sub = walk(node.children, path);
      tree.push({ id: node.id, label: node.label, children: sub.tree });
      products.push(...sub.products);
    } else {
      tree.push({ id: node.id, label: node.label });
      if (node.product) {
        products.push(makeProduct(node.id, node.product.name, node.product.base, path));
      }
    }
  }

  return { tree, products };
}

const built = walk(spec, []);

export const categoryTree: CategoryNode[] = built.tree;
export const products: Product[] = built.products;

export function collectIds(node: CategoryNode): string[] {
  const ids = [node.id];
  node.children?.forEach((child) => ids.push(...collectIds(child)));
  return ids;
}

export const priceBounds = products.reduce(
  (acc, p) => ({ min: Math.min(acc.min, p.price), max: Math.max(acc.max, p.price) }),
  { min: Infinity, max: 0 },
);
