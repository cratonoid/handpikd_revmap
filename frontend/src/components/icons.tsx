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
