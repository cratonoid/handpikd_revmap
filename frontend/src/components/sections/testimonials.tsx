"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { QuoteIcon } from "@/components/icons";

// Placeholder quotes — swap for real client feedback when available.
const testimonials = [
  {
    quote:
      "Handpikd took our entire client-gifting program off our plate. Sourcing, packing, tracking — all handled, and every recipient loved what showed up.",
    name: "Priya Shah",
    title: "Director of Client Success, Vertex Industries",
    initials: "PS",
  },
  {
    quote:
      "Onboarding kits used to be a scramble every time we hired. Now new employees get a Handpikd box on day one, automatically, every time.",
    name: "Marcus Lee",
    title: "Head of People Ops, Solace Group",
    initials: "ML",
  },
  {
    quote:
      "We ran a 2,000-recipient holiday campaign with individual tracking for every box. Handpikd's dashboard made it painless to manage.",
    name: "Elena Torres",
    title: "VP Marketing, Continental Traders",
    initials: "ET",
  },
];

const avatarTones = ["bg-charcoal text-cream", "bg-cream-deep text-charcoal", "bg-charcoal/10 text-charcoal"];

export function Testimonials() {
  const gridRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-testimonial-card]");
      if (!cards?.length) return;

      const mm = gsap.matchMedia();
      mm.add({ animate: "(prefers-reduced-motion: no-preference)" }, () => {
        // A slight overshoot ("back" ease) gives the entrance physical weight,
        // as if each card has mass settling into place.
        gsap.fromTo(
          cards,
          { y: 56, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            ease: "back.out(1.6)",
            stagger: 0.15,
            scrollTrigger: {
              trigger: gridRef.current,
              start: "top 82%",
              toggleActions: "play none none none",
            },
          },
        );
      });

      return () => mm.revert();
    },
    { scope: gridRef },
  );

  return (
    <section className="bg-cream-deep">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Client Feedback</Eyebrow>
          <SplitReveal
            as="h2"
            text="What our partners say"
            className="mt-3 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
          />
        </Reveal>

        <div ref={gridRef} className="mt-14 grid gap-6 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <figure
              key={t.name}
              data-testimonial-card
              className="flex h-full flex-col rounded-2xl border border-border bg-white p-7 shadow-sm shadow-charcoal/5 will-change-transform"
            >
              <QuoteIcon className="h-7 w-7 text-charcoal/70" />
              <blockquote className="mt-4 flex-1 text-[0.95rem] leading-relaxed text-ink">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ${avatarTones[i % avatarTones.length]}`}
                  aria-hidden="true"
                >
                  {t.initials}
                </span>
                <div>
                  <p className="text-sm font-semibold text-charcoal">{t.name}</p>
                  <p className="text-xs text-ink/70">{t.title}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
