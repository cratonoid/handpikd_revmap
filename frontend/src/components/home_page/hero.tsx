// ---------------------------------------------------------------------------
// <Hero> — the first section of the homepage
// ---------------------------------------------------------------------------
// A plain Server Component (no "use client") — none of the entrance
// animations here need to run in THIS file's own code; they're handled by
// the <Reveal> and <SplitReveal> child components, which each already
// declare their own "use client" where needed. This file itself only builds
// the layout and content.
//
// Styling lives in src/styles/home-page.module.css (a CSS Module) instead
// of Tailwind classes — `styles.heroSection` etc. below resolve to a real,
// uniquely-named CSS class defined in that file, which is where to go to
// change how this section looks.
import Image from "next/image";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import styles from "@/styles/home-page.module.css";

export function Hero() {
  return (
    // `.heroSection` fills roughly one full laptop-sized viewport and
    // vertically centers its content once the screen is at least the `lg`
    // breakpoint wide (see the `@media (min-width: 1024px)` rule in the
    // CSS file) — on smaller screens it just takes up as much height as
    // its content naturally needs.
    <section className={styles.heroSection}>
      {/* Two-column layout on large screens (text on the left, image on the
          right); the columns stack vertically on smaller screens since the
          `grid-template-columns` rule for this only applies at `lg:` and
          up. */}
      <div className={styles.heroInner}>
        <div>
          {/* Small "eyebrow" badge above the headline. Wrapped in <Reveal>
              so it fades/rises in on scroll — see reveal.tsx. */}
          <Reveal>
            <span className={styles.heroBadge}>
              <span className={styles.heroBadgeDot} />
              Bangalore&apos;s Premier Corporate Gifting Company
            </span>
          </Reveal>

          {/* Plain, always-visible heading — deliberately NOT animated.
              This used to use a <SplitReveal> component for a word-by-word
              entrance, but that rendered each word `opacity: 0` by default
              in CSS and relied entirely on a GSAP scroll-triggered effect
              to ever make it visible. If that JS never ran for any reason,
              this being the page's main headline, it stayed permanently
              blank with no fallback — so it's rendered as static text
              instead (same reasoning applied to every other section
              heading on the homepage). */}
          <h1 className={styles.heroHeading}>
            Corporate gifts people actually want to open.
          </h1>

          {/* Each further piece of content uses an increasing `delayMs` so
              they visually cascade in one after another instead of all
              appearing simultaneously. */}
          <Reveal delayMs={280}>
            <p className={styles.heroParagraph}>
              Premium corporate gifting solutions in Bangalore — curated
              luxury hampers, custom gift curation, and branded merchandise
              that leave lasting impressions on clients and employees across
              India.
            </p>
          </Reveal>

          <Reveal delayMs={360}>
            <div className={styles.heroButtonRow}>
              <Button href="#connect" variant="primary" showArrow>
                Plan My Gifting
              </Button>
              <Button href="/catalogue" variant="tertiary">
                Catalogue
              </Button>
            </div>
          </Reveal>
        </div>

        {/* Right column: the hero photo. */}
        <Reveal delayMs={200} className={styles.heroImageCol}>
          <div className={styles.heroImageBox}>
            {/* next/image automatically optimizes images (resizing,
                converting to modern formats like WebP, lazy-loading by
                default). `fill` makes it stretch to cover its parent
                (which is why the parent <div> needs `position: relative` +
                explicit sizing via `aspect-ratio`, both set on
                `.heroImageBox`), and `priority` tells Next.js to load THIS
                particular image as early as possible since it's the first
                thing visible on the page (skipping the normal lazy-loading
                behavior, which is meant for images further down the
                page). `sizes` hints at how large the image will actually
                be displayed at different screen widths, so Next.js can
                pick an appropriately-sized file instead of always serving
                the biggest version. */}
            <Image
              src="/site/service-hampers.jpg"
              alt="Premium curated corporate gift hamper from Handpikd, Bangalore's leading corporate gifting company"
              fill
              priority
              sizes="(min-width: 1024px) 420px, (min-width: 640px) 60vw, 90vw"
              className={styles.heroImageFill}
            />
          </div>
          {/* A small purely-decorative bordered square peeking out from
              behind the photo — hidden from screen readers since it
              conveys no information, and hidden on small screens (see the
              `display: none` / `@media (min-width: 640px) { display:
              block }` pair in the CSS) where there isn't room for it to
              look intentional. */}
          <div aria-hidden="true" className={styles.heroDecorSquare} />
        </Reveal>
      </div>
    </section>
  );
}
