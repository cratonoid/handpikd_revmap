// ---------------------------------------------------------------------------
// Icon set
// ---------------------------------------------------------------------------
// Every icon used across the site is a small hand-written SVG component
// defined in this one file, instead of pulling in an icon library (like
// react-icons or lucide-react). Benefits of doing it this way:
//   - Zero extra dependency / bundle size — just plain SVG markup.
//   - Every icon automatically shares the exact same visual style (stroke
//     width, rounded corners) because they all spread the same `base`
//     object of shared SVG attributes.
//   - `stroke="currentColor"` means each icon's color is controlled purely
//     by CSS `color` (e.g. Tailwind's `text-charcoal`, `text-red`, etc.) —
//     no need to pass a separate "color" prop.
import type { SVGProps } from "react";

// `SVGProps<SVGSVGElement>` is a TypeScript type (built into React's type
// definitions) describing every valid prop an <svg> element can accept —
// className, style, onClick, aria-*, and so on. Using it as the prop type
// for every icon component below means callers can pass any normal SVG/HTML
// attribute (most commonly just `className="h-4 w-4"` to size it).
type IconProps = SVGProps<SVGSVGElement>;

// Shared default attributes spread onto every icon's <svg> tag. Defining
// them once here (rather than repeating them in all ~13 icon components)
// is what guarantees every icon in the app looks visually consistent.
const base = {
  viewBox: "0 0 24 24", // SVGs are drawn on a 24x24 unit grid; actual on-screen size is set via CSS (e.g. h-4 w-4)
  fill: "none", // icons are outlines, not filled shapes
  stroke: "currentColor", // use whatever the current CSS text color is
  strokeWidth: 1.75,
  strokeLinecap: "round" as const, // rounds off the ends of open lines
  strokeLinejoin: "round" as const, // rounds off the corners where lines meet
  "aria-hidden": true, // hides purely decorative icons from screen readers (the visible text next to an icon usually already says what it means)
};

// Each function below follows the exact same pattern: accept whatever props
// are passed in (typically just a `className` for sizing/color), spread the
// shared `base` attributes first, then spread the caller's own `props`
// AFTER — so a caller-provided prop (like a custom strokeWidth) can override
// a default from `base` if needed, since later spreads win.

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.6 4.5h2.4l1.4 4.3-2 1.6a11.3 11.3 0 0 0 5.2 5.2l1.6-2 4.3 1.4v2.4c0 1.1-.9 2-2 2-8 0-15-7-15-15 0-1.1.9-2 2-2Z" />
    </svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.25" />
    </svg>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 8.5c-2 0-3.5 1.6-3.5 4v3h4v-4H6.5c0-1.4.9-2.3 2-2.3ZM17 8.5c-2 0-3.5 1.6-3.5 4v3h4v-4H15c0-1.4.9-2.3 2-2.3Z" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 13 4 4 10-10" />
    </svg>
  );
}

// Used for the mobile nav "hamburger" open button (see header.tsx).
export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

// Used for the mobile nav "close" button, and the mobile filter drawer's
// close button (see header.tsx and products-page-client.tsx).
export function XMarkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function LinkedInIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 10.5v6M8 7.75v.01M12 16.5v-3.75c0-1.24 1-2.25 2.25-2.25S16.5 11.51 16.5 12.75v3.75" />
    </svg>
  );
}

// The filter/adjustments icon on the mobile "Filters" button
// (products-page-client.tsx).
export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M21 18h-1" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M16.8 7.2h.01" />
    </svg>
  );
}

// Footer's WhatsApp link (footer.tsx) — the classic speech-bubble +
// handset mark, drawn stroke-only to match this icon set's house style.
export function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.5a7.5 7.5 0 0 0-6.5 11.2L4.5 19.5l3.9-1A7.5 7.5 0 1 0 12 4.5Z" />
      <path d="M9.3 9.6c.2-.5.4-.5.6-.5h.35c.2 0 .35 0 .5.35.2.4.6 1.3.65 1.4.05.1.05.25 0 .4-.1.2-.15.3-.3.45-.15.15-.3.3-.15.55.3.5 1.5 1.9 2.9 2.2.2.05.35 0 .5-.2.15-.2.6-.7.75-.9.15-.2.3-.15.5-.1l1.3.6c.2.1.35.15.4.25.05.15.05.6-.15 1.1-.2.5-1.15 1-1.6 1-.45 0-1.2-.05-2.75-1-1.65-1-2.9-2.75-3-2.9-.1-.15-.8-1.05-.8-2 0-.9.45-1.35.6-1.5Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dashboard icons (components/dashboard-shell.tsx)
// ---------------------------------------------------------------------------
// Used for the /admin and /customer sidebar nav links, plus the logout
// action in the dashboard top bar.

export function ChartBarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V13M10 20V6M16 20v-9" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 20c.7-3.3 2.9-5.2 5.5-5.2s4.8 1.9 5.5 5.2" />
      <circle cx="17" cy="9.2" r="2.3" />
      <path d="M15.7 12.4c1.8.4 3.1 1.9 3.7 4.4" />
    </svg>
  );
}

export function ShoppingCartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L20 8H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  );
}

export function ArchiveBoxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1" />
      <path d="M4.5 8.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

export function CubeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <path d="M4 8l8 4.5M12 12.5 20 8M12 12.5V21" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M11.5 4H5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l6.5-6.5a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.7-.3Z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </svg>
  );
}

export function DocumentTextIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3.5h7l4 4V19.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4" />
    </svg>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3.5h12v17l-2.2-1.4L13.6 20l-1.6-1.4L10.4 20l-2.2-1.4L6 20.5Z" />
      <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </svg>
  );
}

export function StorefrontIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9.5 5 4h14l1 5.5" />
      <path d="M4 9.5a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 2.5 0V20H4V9.5Z" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Category tree icons (components/admin/category-tree-node.tsx)
// ---------------------------------------------------------------------------

// Expand/collapse chevron — rotated 90deg via CSS when a tree node is
// expanded, so only one icon is needed for both states.
export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M5.5 7l.75 12A2 2 0 0 0 8.25 21h7.5a2 2 0 0 0 2-1.9L18.5 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.75 13.5h4.5l1.5 2.25h4.5l1.5-2.25h4.5" />
      <path d="M5.7 4.5h12.6l1.95 9v4.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-4.5l1.95-9Z" />
    </svg>
  );
}

export function ArrowUpTrayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Catalogue category icons (components/catalogue/catalogue-card.tsx)
// ---------------------------------------------------------------------------
// One icon per catalogue category — used instead of a photo on each card,
// since the real photos in public/catalogs are scanned catalogue PAGES
// (either a generic branded cover slide or a dense multi-item grid), not
// individual product shots, so none of them make a clean square thumbnail.
// The actual photos still appear once a card is clicked, inside the
// lightbox gallery (see gallery-lightbox.tsx).

export function GiftBoxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="10.5" width="16" height="9" rx="1.25" />
      <path d="M4 10.5h16M12 10.5V19.5" />
      <path d="M8.25 10.5c-1.66 0-3-1.23-3-2.75S6.59 5 8.25 5c2.25 0 3.75 2.25 3.75 5.5" />
      <path d="M15.75 10.5c1.66 0 3-1.23 3-2.75S17.41 5 15.75 5C13.5 5 12 7.25 12 10.5" />
    </svg>
  );
}

export function BottleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3h4v3.4c0 .45.17.88.48 1.2l.9 1c.4.44.62 1 .62 1.6V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-8.8c0-.6.22-1.16.62-1.6l.9-1c.31-.32.48-.75.48-1.2V3Z" />
      <path d="M9.25 13.5h5.5M9 6.5h6" />
    </svg>
  );
}

export function DiaryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 4.75h11A2.5 2.5 0 0 1 19 7.25V19a1 1 0 0 1-1 1H8a2.5 2.5 0 0 1-2.5-2.5V4.75Z" />
      <path d="M5.5 17.5A2.5 2.5 0 0 1 8 15h11" />
    </svg>
  );
}

// Distinct from DiaryIcon (a spiral binding along the left edge, vs. a
// bookmark ribbon) so "Diaries" and "Notebooks" don't look identical next
// to each other in the /catalogue grid.
export function NotebookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7.5" y="4" width="12" height="16" rx="1.5" />
      <path d="M4.5 6.5H7M4.5 10H7M4.5 13.5H7M4.5 17H7" />
    </svg>
  );
}

export function IdCardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <circle cx="9" cy="10.5" r="1.9" />
      <path d="M5.8 15.7c.55-1.8 1.9-2.7 3.2-2.7s2.65.9 3.2 2.7" />
      <path d="M14.5 9h4M14.5 11.75h4M14.5 14.5h2.5" />
    </svg>
  );
}

// A split-ring with a tag hanging from it (rather than a ring + diagonal
// line, which reads as a magnifying glass instead of a keychain).
export function KeychainIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="6.5" r="2.75" />
      <path d="M12 9.25V13" />
      <rect x="8" y="13" width="8" height="7" rx="2" />
    </svg>
  );
}

export function MugIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 6h11v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6Z" />
      <path d="M16 8.5h1.25a2.5 2.5 0 1 1 0 5H16" />
      <path d="M8 3.5c0 .9-1 1.1-1 2" />
    </svg>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20l.9-4.3L15.4 5.2a2.1 2.1 0 0 1 3 3L7.9 19.1 4 20Z" />
      <path d="M13 7.2l3.8 3.8" />
    </svg>
  );
}

export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 4h8v4.5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5.25H5.75A1.25 1.25 0 0 0 4.5 6.5c0 2 1.6 3.75 4 3.75" />
      <path d="M16 5.25h2.25A1.25 1.25 0 0 1 19.5 6.5c0 2-1.6 3.75-4 3.75" />
      <path d="M12 12.5v3M9 20h6M9.25 20c0-1.9 1.05-3 2.75-3s2.75 1.1 2.75 3" />
    </svg>
  );
}
