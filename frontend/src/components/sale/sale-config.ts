// ---------------------------------------------------------------------------
// Seasonal sale wording — shared by every sale touch on the site
// ---------------------------------------------------------------------------
// The sale shows the running strip on every page, festive bands on
// /products and /catalogue, the hero badge and stamp on the homepage, and
// ribbons on product/catalogue cards.
//
// To remove it: delete src/components/sale/ and src/styles/sale.module.css,
// then undo every line marked `SALE:` (search the codebase for "SALE:").

export const SALE_NAME = "Diwali Sale";
export const SALE_OFFER = "Up to 20% off on all products";

// Phrases that scroll across the running strip, in order.
export const SALE_STRIP_MESSAGES = [
  `${SALE_NAME} is live`,
  SALE_OFFER,
  "Festive gifting for teams & clients",
  "Shop the catalogue",
];

// Short label for the ribbons on product and catalogue cards. Deliberately
// not a percentage — card prices aren't changed by the sale, so the ribbon
// shouldn't promise a specific discount on a specific item.
export const SALE_RIBBON = "Diwali Special";
