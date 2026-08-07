// ---------------------------------------------------------------------------
// <ClientMarquee> — the endlessly-scrolling row of client logos
// ---------------------------------------------------------------------------
// A plain Server Component — the actual scrolling animation is pure CSS
// (see the `.marquee-track` / `@keyframes marquee` rules, which stay in
// src/app/globals.css since they're truly global/reusable, rather than
// section-specific), so no client-side JavaScript is needed here at all.
//
// The rest of this section's styling lives in
// src/styles/home-page.module.css.
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/eyebrow";
import { CompanyLogo } from "@/components/company-logos";
import styles from "@/styles/home-page.module.css";

// Placeholder client roster — swap for real logo files when available.
// `Parameters<typeof CompanyLogo>[0]["icon"]` is a slightly advanced
// TypeScript trick: rather than retyping the exact list of valid icon names
// here, it reaches into the <CompanyLogo> component's own prop types
// (Parameters<...>[0] = "the type of its first argument", i.e. its props
// object, then `["icon"]` = "just the `icon` field of that"). This means if
// company-logos.tsx ever adds/renames an icon, this array's type-checking
// updates automatically without needing to be kept in sync by hand.
const clients: { name: string; icon: Parameters<typeof CompanyLogo>[0]["icon"] }[] = [
  { name: "Northwind Corp", icon: "compass" },
  { name: "Anchor & Co.", icon: "anchor" },
  { name: "Vertex Industries", icon: "peak" },
  { name: "Solace Group", icon: "sun" },
  { name: "Marigold Partners", icon: "bloom" },
  { name: "Halcyon Labs", icon: "wave" },
  { name: "Continental Traders", icon: "globe" },
  { name: "Everline Co.", icon: "infinity" },
];

// Renders one full pass of all 8 logos. Used TWICE in <ClientMarquee> below
// (see the big comment there for why) — `ariaHidden` lets the second,
// duplicate copy be hidden from screen readers so they don't announce the
// same 8 company names twice.
function ClientRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <ul className={styles.marqueeRow} aria-hidden={ariaHidden || undefined}>
      {clients.map((client, i) => (
        <li key={`${client.name}-${i}`} className={styles.marqueeItem}>
          <CompanyLogo name={client.name} icon={client.icon} className={styles.marqueeLogo} />
        </li>
      ))}
    </ul>
  );
}

export function ClientMarquee() {
  return (
    <section className={styles.marqueeSection}>
      <Reveal className={styles.marqueeHeader}>
        <Eyebrow>Who We&apos;ve Worked With</Eyebrow>
        <h2 className={styles.marqueeHeading}>
          Brands that trust Handpikd with their gifting
        </h2>
      </Reveal>

      {/* `overflow: hidden` (on `.marqueeViewport`) clips anything outside
          this box, so the wide scrolling strip inside doesn't cause the
          whole page to scroll sideways. The inline `style` applies a CSS
          "mask" — a gradient that fades from transparent -> fully opaque
          -> transparent again across the width of the element. Wherever
          the mask is transparent, the content underneath it is hidden;
          wherever it's opaque, the content shows normally. The net effect
          is that logos fade out smoothly right as they reach the
          left/right edges, instead of being harshly clipped mid-logo.
          `WebkitMaskImage` is the Safari/older-Chrome-specific version of
          the same property — both are set for broad browser support. This
          stays as an inline `style` object (rather than a CSS Module
          class) because CSS masks aren't something a plain class name
          buys much for here — it's a one-off, self-contained effect. */}
      <div
        className={`marquee-group group ${styles.marqueeViewport}`}
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
      >
        {/* The strip contains the logo row TWICE back to back. Combined
            with the `marquee` CSS animation (globals.css) that slides this
            whole container left by exactly 50% of its own width, the
            second copy lands exactly where the first one started right as
            the loop repeats — creating the illusion of an infinitely
            repeating strip instead of a strip that visibly "resets".
            `marquee-track` is the plain global class (globals.css) the
            animation keyframes target. */}
        <div className={`marquee-track ${styles.marqueeRow}`}>
          <ClientRow />
          <ClientRow ariaHidden />
        </div>
      </div>
    </section>
  );
}
