// ---------------------------------------------------------------------------
// <Button> — the site's one reusable button/link component
// ---------------------------------------------------------------------------
// Every clickable call-to-action across the site (Header's "Get Started",
// the Hero buttons, the contact form's submit button, etc.) renders through
// this ONE component instead of each place writing its own <button>/<a>
// styling by hand. That's what guarantees every button with the same
// `variant` looks and behaves identically everywhere.
//
// A key trick this component uses: it can render as EITHER a real HTML
// <button> (for things that submit forms or run JavaScript) OR a Next.js
// <Link> (for things that navigate to a URL), depending on whether an
// `href` prop was passed in — see the `if (href)` branch near the bottom.
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { ArrowRightIcon } from "@/components/icons";

// The three visual styles a button can have. Each is a string of Tailwind
// classes controlling background/text color for the resting and :hover
// states, plus which color the keyboard-focus ring uses. The actual colors
// (`bg-button-primary`, etc.) come from the CSS variables defined in
// globals.css / brand.ts — see those files for the current hex values.
const variants = {
  primary: // red — the loudest option, used for the main call-to-action on a page
    "bg-button-primary text-cream hover:bg-button-primary-hover focus-visible:outline-button-primary",
  secondary: // black — used for a secondary-but-still-strong action
    "bg-button-secondary text-cream hover:bg-button-secondary-hover focus-visible:outline-button-secondary",
  tertiary: // light beige — the softest "ghost" button style
    "bg-button-tertiary text-charcoal hover:bg-button-tertiary-hover focus-visible:outline-button-tertiary",
} as const;

// `keyof typeof variants` gives a union type of the object's key names:
// "primary" | "secondary" | "tertiary". This is what makes TypeScript
// autocomplete/validate the `variant` prop below.
type Variant = keyof typeof variants;

// Classes shared by every button regardless of variant: size, shape,
// spacing, and the small "shrink 2%" animation on click
// (`active:scale-[0.98]`) that gives a tactile "press" feel.
const shared =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]";

export function Button({
  variant = "primary",
  href, // if provided, renders as a Link that navigates here instead of a <button>
  showArrow = false, // adds a small arrow icon after the button text
  className = "",
  children,
  onClick,
  ...props // any other standard <button> props (e.g. type="submit", disabled) get forwarded through
}: {
  variant?: Variant;
  href?: string;
  showArrow?: boolean;
  className?: string;
  children: React.ReactNode;
  // `Omit<ComponentPropsWithoutRef<"button">, "className" | "children">` =
  // "every prop a real <button> element normally accepts, EXCEPT className
  // and children" (which are already declared explicitly above, with our
  // own more specific types). This is how `{...props}` below can safely
  // forward things like `type`, `disabled`, or `aria-label` without this
  // component needing to know about each one individually.
} & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">) {
  // Combine the shared classes with this variant's colors and any custom
  // className passed in by the caller, once, so both the <Link> branch and
  // the <button> branch below can reuse the exact same string.
  const classes = `${shared} ${variants[variant]} ${className}`;

  // The button's actual visible content — built once and reused in both
  // possible return branches below, so the arrow-icon logic doesn't have
  // to be duplicated.
  const content = (
    <>
      {children}
      {showArrow && (
        // `group-hover:translate-x-0.5` (paired with `group` on the shared
        // classes above) nudges the arrow slightly to the right whenever
        // the BUTTON is hovered — not just when the icon itself is
        // hovered. That's what Tailwind's "group" pattern is for: applying
        // a hover effect to a child based on hovering its ancestor.
        <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        // `onClick` here is typed for a plain HTML button
        // (`React.MouseEventHandler<HTMLButtonElement>` further down), but
        // Next.js's <Link> expects an anchor-element event handler instead.
        // `as unknown as ...` is a TypeScript type-cast telling the
        // compiler "trust me, this is fine" — safe here because the
        // callers of <Button> only ever pass a simple `() => void`
        // function that doesn't actually use the event argument's specific
        // type.
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {content}
      </Link>
    );
  }

  return (
    <button className={classes} onClick={onClick} {...props}>
      {content}
    </button>
  );
}
