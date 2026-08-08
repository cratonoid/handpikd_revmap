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

// Client roster — logo files live in public/client-logos/.
const clients: { name: string; src: string }[] = [
  { name: "Unnati", src: "/client-logos/unnati.png" },
  { name: "CHRIST (Deemed to be University)", src: "/client-logos/christ-university.png" },
  { name: "Evolve", src: "/client-logos/evolve.png" },
  { name: "Rotary Club of Mapusa — Elegance", src: "/client-logos/rotary-club-mapusa-elegance.png" },
  { name: "St Joseph's University", src: "/client-logos/st-josephs-university.png" },
  { name: "IMA Bangalore Chapter", src: "/client-logos/ima-bangalore-chapter.png" },
  { name: "Wall St Society", src: "/client-logos/wall-street-society.png" },
  { name: "Shree Vedic Enterprises", src: "/client-logos/shree-vedic-enterprises.png" },
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
          <CompanyLogo name={client.name} src={client.src} />
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
