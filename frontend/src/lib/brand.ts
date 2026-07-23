// Handpikd brand tokens. Update these hex values to retheme the whole site —
// they back the CSS custom properties consumed by Tailwind in globals.css.
export const colors = {
  // Core brand palette: bright off-white, beige, and black accents only.
  cream: "#FAFAF8", // off-white — main background (whiter than eggshell)
  creamDeep: "#F1E4CE", // beige — alternate section fill / card accents
  charcoal: "#0B0A08", // near-black — headers, icons, primary accents
  ink: "#38332C", // dark warm gray — body copy
  white: "#E6E4DC", // "white" surfaces (cards/chips) — warm off-white, not stark
  red: "#9C2B2B", // very sparing accent only — small dots, badges, underlines

  // Three distinct neutrals — one per button tier.
  buttonPrimary: "#0B0A08",
  buttonPrimaryHover: "#211D16",
  buttonSecondary: "#C9B475",
  buttonSecondaryHover: "#B5A066",
  buttonTertiary: "#F1E9D2",
  buttonTertiaryHover: "#E6DAB8",

  border: "#C7B37E",
} as const;

export type BrandColor = keyof typeof colors;

export const siteConfig = {
  name: "Handpikd",
  tagline: "Thoughtful corporate gifting, handpikd for every occasion.",
  navLinks: [
    { label: "Home", href: "/" },
    { label: "About", href: "/#who-we-are" },
    { label: "Products", href: "/products" },
    { label: "Blogs", href: "/blogs" },
    { label: "Contact", href: "/#connect" },
  ],
  contact: {
    email: "hello@handpikd.com",
    phone: "+1 (844) 555-0142",
    address: "148 Ribbon Row, Suite 400, Austin, TX 78701",
  },
  social: [
    { label: "LinkedIn", href: "https://linkedin.com" },
    { label: "Instagram", href: "https://instagram.com" },
  ],
} as const;
