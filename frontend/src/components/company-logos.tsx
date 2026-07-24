// ---------------------------------------------------------------------------
// Placeholder "client logo" marks
// ---------------------------------------------------------------------------
// Used by the scrolling client marquee (src/components/sections/client-
// marquee.tsx) to represent the (fictional, placeholder) companies Handpikd
// has "worked with". Since there are no real client logos yet, each company
// gets a small abstract line-art icon instead — drawn the exact same way as
// the site's regular icon set (src/components/icons.tsx): stroke-only,
// currentColor, no background. Swap these for real client logo files
// whenever they're available.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Same idea as icons.tsx's `base` object — shared SVG defaults so every
// mark below is visually consistent.
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

// Eight small hand-drawn marks, one per placeholder company below. Each is
// a private (not exported) function — only the `marks` lookup table and
// <CompanyLogo> component at the bottom are meant to be used from outside
// this file.

function CompassMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-2 5-4 1 2-5z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AnchorMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="6" r="2" />
      <path d="M12 8v13M7 13H3.5A8.5 8.5 0 0 0 12 21a8.5 8.5 0 0 0 8.5-8H16" />
      <path d="M9 11h6" />
    </svg>
  );
}

function PeakMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19 11 6l3 5 2-2.5 4 10.5z" strokeLinejoin="round" />
    </svg>
  );
}

function SunMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </svg>
  );
}

function BloomMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2" />
      <ellipse cx="12" cy="6.5" rx="2.2" ry="3.2" />
      <ellipse cx="12" cy="17.5" rx="2.2" ry="3.2" />
      <ellipse cx="6.5" cy="12" rx="3.2" ry="2.2" />
      <ellipse cx="17.5" cy="12" rx="3.2" ry="2.2" />
    </svg>
  );
}

function WaveMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9c1.8-1.6 3.6-1.6 5.4 0s3.6 1.6 5.4 0 3.6-1.6 5.4 0" />
      <path d="M3 14.5c1.8-1.6 3.6-1.6 5.4 0s3.6 1.6 5.4 0 3.6-1.6 5.4 0" />
      <path d="M3 20c1.8-1.6 3.6-1.6 5.4 0s3.6 1.6 5.4 0 3.6-1.6 5.4 0" />
    </svg>
  );
}

function GlobeMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 2.6 4.2 5.7 4.2 9s-1.4 6.4-4.2 9c-2.8-2.6-4.2-5.7-4.2-9S9.2 5.6 12 3Z" />
    </svg>
  );
}

function InfinityMark(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 9a3.5 3.5 0 0 0 0 7c2.5 0 3.8-2.2 5-4s2.5-3.5 5-3.5a3.5 3.5 0 1 1 0 7c-2.5 0-3.8-2.2-5-4S9.5 7.5 7 9Z" />
    </svg>
  );
}

// A lookup table mapping a short string name (used as the `icon` prop
// below) to the actual component function that draws it. `Record<string,
// ...>` is a TypeScript type meaning "an object where every key is a
// string, and every value is a function that takes IconProps and returns
// JSX." This pattern — string name -> component — is what lets
// client-marquee.tsx say `icon: "compass"` in its plain data array instead
// of importing and referencing `CompassMark` directly.
const marks: Record<string, (props: IconProps) => React.JSX.Element> = {
  compass: CompassMark,
  anchor: AnchorMark,
  peak: PeakMark,
  sun: SunMark,
  bloom: BloomMark,
  wave: WaveMark,
  globe: GlobeMark,
  infinity: InfinityMark,
};

/** Icon-only placeholder "logo" — no text label, no background. */
export function CompanyLogo({
  name, // the company's real name, used only for accessibility (see aria-label below) — not rendered as visible text
  icon, // which mark to draw; `keyof typeof marks` restricts this to exactly the 8 keys defined in `marks` above
  className = "",
}: {
  name: string;
  icon: keyof typeof marks;
  className?: string;
}) {
  // Look up which component function to render based on the `icon` prop.
  const Mark = marks[icon];
  return (
    // `role="img"` + `aria-label={name}` together tell screen readers "treat
    // this whole element as a single image described by this text" — since
    // there's no visible text naming the company, this is how a screen
    // reader user still learns which company each mark represents. The
    // <svg> itself stays `aria-hidden` (set in `base` above) so it isn't
    // announced a second time redundantly.
    <span role="img" aria-label={name} className={`inline-flex text-charcoal/55 ${className}`}>
      <Mark className="h-full w-full" />
    </span>
  );
}
