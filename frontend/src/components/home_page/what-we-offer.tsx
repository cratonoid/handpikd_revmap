// ---------------------------------------------------------------------------
// <WhatWeOffer> — grid of gifting-program categories (id="what-we-offer")
// ---------------------------------------------------------------------------
// A plain Server Component: a heading, then a responsive grid of photo
// cards. Each card's hover effects (image zoom, darkening overlay, "Learn
// more" fade-in) are done with pure CSS (`.offerCard:hover .offerImage`
// etc. in home-page.module.css), so no JavaScript is needed here at all.
import Image from "next/image";
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ArrowUpRightIcon } from "@/components/icons";
import styles from "@/styles/home-page.module.css";

// One entry per card in the grid below. Keeping this as a plain data array
// (rather than 6 hand-written <article> blocks) means the `.map()` further
// down only has to describe the CARD LAYOUT once, and adding a 7th offer
// later is just one more object in this list.
const offers = [
  {
    index: "01",
    title: "Client & Prospect Gifting",
    blurb: "Relationship-building gifts timed to deals, renewals, and referrals.",
    image:
      "https://images.unsplash.com/photo-1513151233558-d860c5398176?auto=format&fit=crop&w=1000&q=80",
    alt: "Wrapped corporate client gift box with ribbon",
  },
  {
    index: "02",
    title: "Employee Milestone Kits",
    blurb: "Onboarding, work anniversaries, and promotions — automated and on-brand.",
    image:
      "https://images.unsplash.com/photo-1608755728617-aefab37d2edd?auto=format&fit=crop&w=1000&q=80",
    alt: "Employee onboarding gift kit with branded ribbon",
  },
  {
    index: "03",
    title: "Event & Conference Gifting",
    blurb: "Booth swag, speaker gifts, and VIP send-offs delivered on schedule.",
    image:
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1000&q=80",
    alt: "Team preparing gifts for a corporate event",
  },
  {
    index: "04",
    title: "Festive & Seasonal Campaigns",
    blurb: "Holiday and year-end programs planned months ahead, packed on time.",
    image:
      "https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=1000&q=80",
    alt: "Seasonal corporate gift box wrapped in red ribbon",
  },
  {
    index: "05",
    title: "Custom Branded Merchandise",
    blurb: "Logo apparel and keepsakes sourced, sampled, and quality-checked.",
    image:
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1000&q=80",
    alt: "Flat lay of custom branded corporate merchandise",
  },
  {
    index: "06",
    title: "Bulk & Enterprise Programs",
    blurb: "Thousands of recipients, one dashboard, individual tracking numbers.",
    image:
      "https://images.unsplash.com/photo-1512909006721-3d6018887383?auto=format&fit=crop&w=1000&q=80",
    alt: "Bulk corporate gift boxes ready for nationwide shipping",
  },
];

export function WhatWeOffer() {
  return (
    <section id="what-we-offer" className={styles.offerSection}>
      <div className={styles.offerInner}>
        <Reveal className={styles.offerHeader}>
          <Eyebrow>What We Offer</Eyebrow>
          <h2 className={styles.offerHeading}>
            Gifting programs for every part of the business
          </h2>
          <p className={styles.offerParagraph}>
            Pick one program or run them all — every offer below is managed by
            the same Handpikd account team.
          </p>
        </Reveal>

        {/* 1 column on mobile, 2 on small tablets, 3 on large screens (see
            the `@media` rules on `.offerGrid`). */}
        <div className={styles.offerGrid}>
          {offers.map((offer, i) => (
            // `(i % 3) * 60` staggers each card's entrance delay based on
            // its position within a row of 3 (0ms, 60ms, 120ms, then
            // repeating 0ms, 60ms, 120ms for the next row) — `%` is the
            // "remainder" (modulo) operator, so `i % 3` cycles through
            // 0, 1, 2, 0, 1, 2... as `i` increases.
            <Reveal key={offer.title} delayMs={(i % 3) * 60}>
              {/* `.offerCard` (paired with `.offerCard:hover ...` rules in
                  the CSS) is what lets hovering ANYWHERE on the card
                  trigger effects on its image, overlay, and "Learn more"
                  text together — the CSS Module equivalent of Tailwind's
                  "group" pattern used elsewhere in the app. */}
              <article className={styles.offerCard}>
                <Image
                  src={offer.image}
                  alt={offer.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  // Slightly zooms the photo in on hover — a subtle "Ken
                  // Burns"-style effect that adds life to an otherwise
                  // static image.
                  className={styles.offerImage}
                />
                {/* A dark gradient overlay (transparent at the very top,
                    solid charcoal at the bottom) so the white title/blurb
                    text stays readable against any photo. It darkens
                    further on hover to help the "Learn more" text (which
                    is invisible until hovered) stand out. */}
                <div aria-hidden="true" className={styles.offerOverlay} />
                <div className={styles.offerContent}>
                  <span className={styles.offerIndex}>{offer.index}</span>
                  <h3 className={styles.offerTitle}>{offer.title}</h3>
                  <p className={styles.offerBlurb}>{offer.blurb}</p>
                  {/* Invisible until the card is hovered, at which point it
                      fades in. The CSS also keeps it always visible for
                      users with reduced-motion preferences (see the
                      `@media (prefers-reduced-motion: reduce)` rule on
                      `.offerLearnMore`), since the hover fade itself is a
                      small motion effect some people prefer to skip. */}
                  <span className={styles.offerLearnMore}>
                    Learn more
                    <ArrowUpRightIcon className="h-4 w-4" />
                  </span>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
