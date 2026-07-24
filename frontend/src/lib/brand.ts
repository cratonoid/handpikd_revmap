// ---------------------------------------------------------------------------
// Handpikd brand tokens
// ---------------------------------------------------------------------------
// This file is the single source of truth for the site's colors and basic
// company info (nav links, contact details, social links).
//
// IMPORTANT: changing a color here does NOT automatically change the site.
// Tailwind CSS reads colors from CSS custom properties (variables) defined in
// `src/app/globals.css`, not from this TypeScript file directly. The two are
// kept in sync BY HAND — if you change a hex value here, you must also
// update the matching `--color-*` line in globals.css. This file exists so
// the values are documented in one readable place and can be imported into
// TypeScript/React code (e.g. to build a JSON-LD script, or to reference a
// color in inline styles) without hardcoding hex codes everywhere.

// `export const colors = {...} as const` creates a plain JavaScript object
// AND tells TypeScript to infer the most specific possible types for it.
// Without `as const`, TypeScript would widen `cream: "#FAFAF8"` to the type
// `string`. With `as const`, it becomes the literal type `"#FAFAF8"`. This
// matters below for `BrandColor`, which reads the exact key names.
export const colors = {
  // --- Core brand palette: bright off-white, beige, and black accents only.
  cream: "#FAFAF8", // off-white — main page background (whiter than eggshell)
  creamDeep: "#E3CE9E", // beige — used to alternate section backgrounds and on card accents
  charcoal: "#0B0A08", // near-black — headings, icons, and primary accents
  ink: "#38332C", // dark warm gray — regular paragraph/body text
  white: "#E6E4DC", // "white" surfaces (cards/chips) — a warm off-white, not stark #FFFFFF
  red: "#9C2B2B", // sparing accent color — small dots, badges, underlines, the primary CTA button

  // --- Three distinct button tiers, each with its own resting + hover color.
  // See src/components/button.tsx for how these are applied per `variant`.
  buttonPrimary: "#9C2B2B", // red — loudest, used for the main call-to-action button
  buttonPrimaryHover: "#7F2222", // darker red shown on :hover
  buttonSecondary: "#0B0A08", // black — used for secondary actions
  buttonSecondaryHover: "#211D16", // lighter black shown on :hover
  buttonTertiary: "#F1E9D2", // light beige — softest "ghost" button style
  buttonTertiaryHover: "#E6DAB8", // slightly deeper beige shown on :hover

  border: "#A68C57", // shared border/divider color used across cards, inputs, and hairlines
} as const;

// `keyof typeof colors` produces a union type of every key name in `colors`,
// i.e. "cream" | "creamDeep" | "charcoal" | ... | "border".
// This type isn't consumed anywhere else in the app yet, but it's exported so
// other files could type a prop like `color: BrandColor` and get autocomplete
// + a compile error if they typo a color name.
export type BrandColor = keyof typeof colors;

// General site metadata used by the Header, Footer, and page <head> tags.
// Centralizing this here means changing the phone number, nav links, etc.
// only has to happen in one place instead of hunting through every component.
export const siteConfig = {
  name: "Handpikd",
  tagline: "Thoughtful corporate gifting, handpikd for every occasion.",

  // Top navigation links, rendered by src/components/header.tsx (desktop nav
  // and mobile menu) and reused by src/components/footer.tsx (minus the
  // "Contact" entry, which the footer handles separately).
  // Links starting with "/#" are same-page anchors: clicking one navigates to
  // "/" and then the browser scrolls to the element with that id
  // (e.g. "/#who-we-are" scrolls to <section id="who-we-are">).
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
