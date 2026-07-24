// ---------------------------------------------------------------------------
// <Eyebrow> — the small uppercase label above every section heading
// ---------------------------------------------------------------------------
// "Eyebrow text" is a common design term for the small label sitting above a
// bigger heading (e.g. "WHO WE ARE" above "Corporate gifting, run like a
// program..."). This component exists so that label — and its little red
// accent dot — looks IDENTICAL everywhere it's used (Hero, Who We Are, What
// We Offer, Testimonials, Connect, the Products page banner, filter sidebar
// labels, etc.) instead of each section re-writing similar-but-slightly-
// different markup by hand.
//
// This is a plain Server Component — no "use client" needed, because it has
// no state, no effects, and no browser-only APIs. It's just a reusable
// snippet of JSX.
export function Eyebrow({
  children, // the label text, e.g. "Who We Are"
  className = "",
  as: Tag = "span", // renders as <span> by default; pass as="p" when it needs to be a block-level element instead
}: {
  children: React.ReactNode;
  className?: string;
  as?: "span" | "p";
}) {
  return (
    <Tag
      className={`inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-charcoal uppercase ${className}`}
    >
      {/* The little red dot. `aria-hidden="true"` hides it from screen
          readers since it's purely decorative — the actual label text
          (`children`) is what matters for accessibility. */}
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
      {children}
    </Tag>
  );
}
