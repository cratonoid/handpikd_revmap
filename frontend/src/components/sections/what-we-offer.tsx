// ---------------------------------------------------------------------------
// <WhatWeOffer> — grid of gifting-program categories (id="what-we-offer")
// ---------------------------------------------------------------------------
// A plain Server Component: a heading, then a responsive grid of photo
// cards. Each card's hover effects (image zoom, darkening overlay, "Learn
// more" fade-in) are done with pure CSS (`group-hover:`), so no JavaScript
// is needed here at all — see the note on Tailwind's "group" pattern in
// button.tsx / header.tsx for how that works.
import Image from "next/image";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ArrowUpRightIcon } from "@/components/icons";

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
    <section
      id="what-we-offer"
      className="flex flex-col justify-center bg-cream-deep py-20 sm:py-24 lg:min-h-screen"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>What We Offer</Eyebrow>
          <SplitReveal
            as="h2"
            text="Gifting programs for every part of the business"
            className="mt-3 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
          />
          <p className="mt-4 text-ink">
            Pick one program or run them all — every offer below is managed by
            the same Handpikd account team.
          </p>
        </Reveal>

        {/* 1 column on mobile, 2 on small tablets, 3 on large screens. */}
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer, i) => (
            // `(i % 3) * 60` staggers each card's entrance delay based on
            // its position within a row of 3 (0ms, 60ms, 120ms, then
            // repeating 0ms, 60ms, 120ms for the next row) — `%` is the
            // "remainder" (modulo) operator, so `i % 3` cycles through
            // 0, 1, 2, 0, 1, 2... as `i` increases.
            <Reveal key={offer.title} delayMs={(i % 3) * 60}>
              {/* `group` (paired with `group-hover:` on children below) is
                  what lets hovering ANYWHERE on the card trigger effects on
                  its image, overlay, and "Learn more" text together. */}
              <article className="group relative flex h-80 flex-col justify-end overflow-hidden rounded-2xl">
                <Image
                  src={offer.image}
                  alt={offer.alt}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  // Slightly zooms the photo in on hover — a subtle "Ken
                  // Burns"-style effect that adds life to an otherwise
                  // static image.
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
                {/* A dark gradient overlay (transparent at the very top,
                    solid charcoal at the bottom) so the white title/blurb
                    text stays readable against any photo. It darkens
                    further on hover (`group-hover:from-charcoal/95
                    group-hover:via-charcoal/60`) to help the "Learn more"
                    text (which is invisible until hovered) stand out. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-charcoal/90 via-charcoal/45 to-charcoal/10 transition-colors duration-300 group-hover:from-charcoal/95 group-hover:via-charcoal/60"
                />
                <div className="relative flex flex-col gap-2 p-6">
                  <span className="font-display text-xs font-semibold tracking-widest text-cream/50">
                    {offer.index}
                  </span>
                  <h3 className="font-display text-xl font-semibold text-white">{offer.title}</h3>
                  <p className="text-sm leading-relaxed text-white/85">{offer.blurb}</p>
                  {/* Invisible (`opacity-0`) until the card is hovered
                      (`group-hover:opacity-100`), at which point it fades
                      in. `motion-reduce:opacity-100` keeps it always
                      visible for users with reduced-motion preferences,
                      since the hover fade itself is a small motion effect
                      some people prefer to skip — for them it's simply
                      always shown instead. */}
                  <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:opacity-100">
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
