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
  // --- Core brand palette: off-white, beige, and pure black/white only.
  cream: "#F5F1ED", // off-white — main page background
  creamDeep: "#F9E9C1", // beige — used to alternate section backgrounds and on card accents
  charcoal: "#000000", // pure black — headings, icons, and primary accents
  ink: "#1A1A1A", // near-black — regular paragraph/body text (softer than pure black on long copy)
  white: "#FFFFFF", // pure white — card/chip surfaces
  red: "#9C2B2B", // sparing accent color — small dots, badges, underlines

  // --- Button tiers. Primary and secondary are both black (same resting
  // color, distinguished only by which action they represent); tertiary
  // stays a lighter "ghost" style so there's still a visual difference
  // between a loud action and a quiet one. See src/components/button.tsx
  // for how these are applied per `variant`.
  buttonPrimary: "#000000", // black — main call-to-action button
  buttonPrimaryHover: "#262626", // lighter black shown on :hover
  buttonSecondary: "#000000", // black — secondary actions
  buttonSecondaryHover: "#262626", // lighter black shown on :hover
  buttonTertiary: "#F9E9C1", // beige — softest "ghost" button style
  buttonTertiaryHover: "#F0D998", // slightly deeper beige shown on :hover

  border: "#D8C6A4", // muted tan — shared border/divider color used across cards, inputs, and hairlines
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
    { label: "Catalogue", href: "/catalogue" },
    { label: "Brand Catalogues", href: "/brand-catalogues" },
    { label: "Blogs", href: "/blogs" },
    { label: "Contact", href: "/#connect" },
  ],

  contact: {
    email: "info@handpikd.co",
    phone: "+91 74116 90399",
    address: "2nd Cross Rd, SGN Layout, Vinobha Nagar, Sudhama Nagar, Bengaluru, Karnataka 560027",
  },

  // No real LinkedIn/Instagram profiles yet, so the footer links to
  // WhatsApp instead (same number as `contact.phone` above) rather than
  // linking out to generic, non-company homepages.
  social: [{ label: "WhatsApp", href: "https://wa.me/917411690399" }],
} as const;
