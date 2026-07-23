"use client";

import { useRef } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { ArrowUpRightIcon } from "@/components/icons";

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

function SectionIntro() {
  return (
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
  );
}

/** Simple hover-card grid — used on small screens and for reduced-motion users. */
function OfferGrid() {
  return (
    <div className="offer-grid mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {offers.map((offer, i) => (
        <Reveal key={offer.title} delayMs={(i % 3) * 60}>
          <article className="group relative flex h-80 flex-col justify-end overflow-hidden rounded-2xl">
            <Image
              src={offer.image}
              alt={offer.alt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
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
              <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:opacity-100">
                Learn more
                <ArrowUpRightIcon className="h-4 w-4" />
              </span>
            </div>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

/** Pinned scroll-scrubbed sequence — desktop, motion-enabled only. */
function OfferStory() {
  const panelRef = useRef<HTMLDivElement>(null);
  const imageLayerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listItemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useGSAP(
    () => {
      const panel = panelRef.current;
      if (!panel) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
        },
        () => {
          const images = imageLayerRefs.current.filter(Boolean) as HTMLDivElement[];
          const items = listItemRefs.current.filter(Boolean) as HTMLLIElement[];

          gsap.set(images, { opacity: 0 });
          gsap.set(images[0], { opacity: 1 });
          gsap.set(items, { opacity: 0.4 });
          gsap.set(items[0], { opacity: 1 });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: panel,
              start: "top top",
              end: `+=${(offers.length - 1) * 650}`,
              scrub: 1,
              pin: true,
            },
          });

          offers.forEach((_, i) => {
            if (i === 0) return;
            const t = i - 0.25;
            tl.to(images[i - 1], { opacity: 0, duration: 0.5 }, t)
              .to(images[i], { opacity: 1, duration: 0.5 }, t)
              .to(items[i - 1], { opacity: 0.4, duration: 0.4 }, t)
              .to(items[i], { opacity: 1, duration: 0.4 }, t);
          });

          return () => tl.scrollTrigger?.kill();
        },
      );

      return () => mm.revert();
    },
    { scope: panelRef },
  );

  return (
    <div ref={panelRef} className="offer-pinned">
      <div className="mx-auto flex h-screen max-w-6xl flex-col justify-center gap-10 px-5 sm:px-8 lg:flex-row lg:items-center lg:gap-16">
        <div className="lg:w-2/5">
          <p className="text-xs font-semibold tracking-[0.14em] text-ink/60 uppercase">
            Scroll to explore
          </p>
          <ol className="mt-6 flex flex-col gap-5">
            {offers.map((offer, i) => (
              <li
                key={offer.title}
                ref={(el) => {
                  listItemRefs.current[i] = el;
                }}
                className="flex items-baseline gap-4"
              >
                <span className="font-display text-sm font-semibold text-charcoal/40">{offer.index}</span>
                <div>
                  <h3 className="font-display text-lg font-semibold text-charcoal">{offer.title}</h3>
                  <p className="text-sm text-ink/70">{offer.blurb}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] shadow-xl shadow-charcoal/10 lg:w-3/5">
          {offers.map((offer, i) => (
            <div
              key={offer.title}
              ref={(el) => {
                imageLayerRefs.current[i] = el;
              }}
              className="absolute inset-0"
            >
              <Image
                src={offer.image}
                alt={offer.alt}
                fill
                sizes="(min-width: 1024px) 55vw, 90vw"
                className="object-cover"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-charcoal/70 via-charcoal/10 to-transparent"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WhatWeOffer() {
  return (
    <section id="what-we-offer" className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <SectionIntro />
      </div>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <OfferGrid />
      </div>
      <OfferStory />
    </section>
  );
}
