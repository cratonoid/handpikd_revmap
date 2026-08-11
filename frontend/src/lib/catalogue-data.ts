// ---------------------------------------------------------------------------
// Catalogue data — categories, sub-items, and image galleries
// ---------------------------------------------------------------------------
// Every image referenced here already exists under `public/catalogs/...`
// (photographs carried over from the previous Handpikd website).
// `catalogue-manifest.json` is a generated file (see the script note at the
// bottom) listing the real filenames inside each of those folders — this
// file only defines how those folders are GROUPED and LABELED for display,
// mirroring the category structure of the old site's catalogue page, plus a
// couple of helpers that turn a folder key into ready-to-use image URLs.
import manifest from "./catalogue-manifest.json";

// Which stock icon (see the "Catalogue category icons" section of
// icons.tsx) represents a category or item. Used instead of a cover photo —
// see the comment above those icons for why.
export type CatalogueIconName =
  | "gift-box"
  | "bottle"
  | "diary"
  | "notebook"
  | "id-card"
  | "keychain"
  | "mug"
  | "pen"
  | "trophy";

export type CatalogueItem = {
  title: string;
  icon: CatalogueIconName;
  // Key into catalogue-manifest.json, e.g. "combo box/2 in 1" — matches the
  // real folder path under public/catalogs.
  folder: string;
};

export type CatalogueCategory = {
  title: string;
  description: string;
  icon: CatalogueIconName;
  items: CatalogueItem[];
};

export const catalogueCategories: CatalogueCategory[] = [
  {
    title: "Corporate Gift Combo Boxes",
    description:
      "Complete premium gift sets with multiple items — perfect for corporate gifting and business events.",
    icon: "gift-box",
    items: [
      { title: "2 in 1", icon: "gift-box", folder: "combo box/2 in 1" },
      { title: "3 in 1", icon: "gift-box", folder: "combo box/3 in 1" },
      { title: "4 in 1", icon: "gift-box", folder: "combo box/4 in 1" },
      { title: "5 in 1", icon: "gift-box", folder: "combo box/5 in 1" },
    ],
  },
  {
    title: "Individual Corporate Gift Items",
    description:
      "Premium individual gift options — custom bottles, branded diaries, notebooks, corporate mugs, personalized pens, and keychains.",
    icon: "gift-box",
    items: [
      { title: "Bottles", icon: "bottle", folder: "bottles/bottles" },
      { title: "Diaries", icon: "diary", folder: "diaries/diaries" },
      { title: "Notebooks", icon: "notebook", folder: "diaries/notebooks" },
      { title: "ID Cards", icon: "id-card", folder: "id cards/id cards" },
      { title: "Keychains", icon: "keychain", folder: "keychains/keychains 1" },
      { title: "Keychains II", icon: "keychain", folder: "keychains/keychains 2" },
      { title: "Mugs", icon: "mug", folder: "mugs/mugs" },
      { title: "Metal Pens", icon: "pen", folder: "pens/metal pens" },
      { title: "Metal Pens II", icon: "pen", folder: "pens/metal pens 2" },
      { title: "Plastic Pens", icon: "pen", folder: "pens/plastic pen" },
    ],
  },
  {
    title: "Diwali Hampers",
    description:
      "Festive gift hampers curated for Diwali — corporate gifting sets for clients, employees, and business partners.",
    icon: "gift-box",
    items: [{ title: "Diwali Hampers", icon: "gift-box", folder: "diwali hampers/diwali hampers" }],
  },
  {
    title: "Corporate Trophies & Awards",
    description:
      "Premium recognition awards, glass trophies, and wooden trophies for employee appreciation and corporate events.",
    icon: "trophy",
    items: [
      { title: "Amaze Trophies", icon: "trophy", folder: "awards and trophies/amaze" },
      { title: "Awards Trophies", icon: "trophy", folder: "awards and trophies/awards tro" },
      { title: "AZ Series", icon: "trophy", folder: "awards and trophies/AZ series" },
      { title: "Crystal Trophies", icon: "trophy", folder: "awards and trophies/crystal" },
      { title: "Crystal Trophies Premium", icon: "trophy", folder: "awards and trophies/crystal tro" },
      { title: "H Series 23-24", icon: "trophy", folder: "awards and trophies/H series 23-24" },
      { title: "H Series 25-26", icon: "trophy", folder: "awards and trophies/H series 25-26" },
      { title: "N Series 25-26", icon: "trophy", folder: "awards and trophies/N series" },
      { title: "Sports Trophies", icon: "trophy", folder: "awards and trophies/sprts tro" },
      { title: "Wooden Mementos", icon: "trophy", folder: "awards and trophies/wooden" },
    ],
  },
];

const files: Record<string, string[]> = manifest;

// Encodes each path segment individually (folder names contain spaces, and
// some contain "&"-adjacent characters) so the resulting string is a valid
// URL no matter what the original filename looked like.
function toUrl(folder: string, filename: string): string {
  return "/catalogs/" + folder.split("/").map(encodeURIComponent).join("/") + "/" + encodeURIComponent(filename);
}

// Every image in a folder, in display order — used by the lightbox gallery
// (see gallery-lightbox.tsx).
export function getGalleryImages(folder: string): string[] {
  return (files[folder] ?? []).map((filename) => toUrl(folder, filename));
}
