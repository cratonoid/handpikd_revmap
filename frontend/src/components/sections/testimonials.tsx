"use client";

// ---------------------------------------------------------------------------
// <Testimonials> — client feedback / quote cards
// ---------------------------------------------------------------------------
// Needs "use client" for the GSAP entrance animation on the cards (a
// "weighted drop" effect, explained below).
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

// One background/text color combo per avatar, cycled through below with
// `avatarTones[i % avatarTones.length]` so the 3 testimonial cards each get
// a visually distinct (but still on-brand) initials badge instead of all
// looking identical.
const avatarTones = ["bg-charcoal text-cream", "bg-red/10 text-red", "bg-cream-deep text-charcoal"];

export function Testimonials() {
  const gridRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // Find every card inside the grid by their shared `data-testimonial-
      // card` attribute (set in the JSX below), rather than hardcoding
      // "there are exactly 3" — this way the animation logic keeps working
      // correctly even if a 4th testimonial is added to the array later.
      const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-testimonial-card]");
      if (!cards?.length) return;

      const mm = gsap.matchMedia();
      mm.add({ animate: "(prefers-reduced-motion: no-preference)" }, () => {
        // A slight overshoot ("back" ease) gives the entrance physical weight,
        // as if each card has mass settling into place.
        gsap.fromTo(
          cards,
          { y: 56, opacity: 0 }, // start 56px below their resting position, invisible
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            // "back.out(1.6)" is an easing curve that overshoots slightly
            // past its target before settling back — like a spring. The
            // `1.6` controls how strong the overshoot is (higher = more
            // bounce).
            ease: "back.out(1.6)",
            stagger: 0.15, // each card starts 150ms after the previous one
            scrollTrigger: {
              trigger: gridRef.current,
              start: "top 82%",
              toggleActions: "play none none none", // play once, never reverse/replay
            },
          },
        );
      });

      return () => mm.revert();
    },
    { scope: gridRef },
  );

  return (
    <section className="flex flex-col bg-cream lg:min-h-screen lg:justify-center">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Client Feedback</Eyebrow>
          <SplitReveal
            as="h2"
            text="What our partners say"
            className="mt-3 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
          />
        </Reveal>

        {/* `ref={gridRef}` is what the GSAP effect above uses to find the
            cards inside it via querySelectorAll. 1 column on mobile, 3
            columns from the `md` breakpoint up. */}
        <div ref={gridRef} className="mt-14 grid gap-6 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <figure
              key={t.name}
              data-testimonial-card // matched by the querySelectorAll call above
              className="flex h-full flex-col rounded-2xl border border-border bg-white p-7 shadow-lg shadow-charcoal/10 will-change-transform"
            >
              <QuoteIcon className="h-7 w-7 text-charcoal/70" />
              <blockquote className="mt-4 flex-1 text-[0.95rem] leading-relaxed text-ink">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                {/* The colored circle showing the person's initials, e.g.
                    "PS" for Priya Shah — used instead of a real headshot
                    photo (there isn't one for a placeholder testimonial).
                    `i % avatarTones.length` cycles through the 3 color
                    options above regardless of how many testimonials exist. */}
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ${avatarTones[i % avatarTones.length]}`}
                  aria-hidden="true" // decorative — the person's real name is printed as text right next to it
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
