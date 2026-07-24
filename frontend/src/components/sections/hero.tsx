// ---------------------------------------------------------------------------
// <Hero> — the first section of the homepage
// ---------------------------------------------------------------------------
// A plain Server Component (no "use client") — none of the entrance
// animations here need to run in THIS file's own code; they're handled by
// the <Reveal> and <SplitReveal> child components, which each already
// declare their own "use client" where needed. This file itself only builds
// the layout and content.
import Image from "next/image";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Counter } from "@/components/counter";

export function Hero() {
  return (
    // `lg:min-h-screen lg:justify-center` makes this section fill roughly
    // one full laptop-sized viewport and vertically center its content,
    // once the screen is at least the `lg` breakpoint wide — on smaller
    // screens it just takes up as much height as its content naturally
    // needs.
    <section className="relative flex flex-col overflow-hidden lg:min-h-screen lg:justify-center">
      {/* Two-column layout on large screens (text on the left, image on the
          right); the columns stack vertically on smaller screens since
          `grid-cols-[...]` only applies at `lg:` and up. */}
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div>
          {/* Small "eyebrow" badge above the headline. Wrapped in <Reveal>
              so it fades/rises in on scroll — see reveal.tsx. */}
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-1.5 text-xs font-semibold tracking-[0.14em] text-charcoal/80 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-red" />
              B2B Corporate Gifting, Done Differently
            </span>
          </Reveal>

          {/* The main heading — uses <SplitReveal> instead of <Reveal>
              because this one animates in WORD BY WORD rather than as one
              block. See split-reveal.tsx for how that works. `delay={80}`
              is milliseconds, letting the badge above finish appearing
              first before the headline starts. */}
          <SplitReveal
            as="h1"
            text="Corporate gifts people actually want to open."
            delay={80}
            className="mt-6 font-display text-4xl leading-[1.08] font-semibold text-charcoal sm:text-5xl lg:text-[3.5rem]"
          />

          {/* Each further piece of content uses an increasing `delayMs` so
              they visually cascade in one after another instead of all
              appearing simultaneously. */}
          <Reveal delayMs={280}>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink">
              Handpikd builds corporate gifting programs for client
              appreciation, employee milestones, and company events —
              sourced, personalized, and shipped nationwide by a dedicated
              account team.
            </p>
          </Reveal>

          <Reveal delayMs={360}>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <Button href="#connect" variant="primary" showArrow>
                Start Your Gifting Program
              </Button>
              <Button href="#what-we-offer" variant="tertiary">
                See What We Offer
              </Button>
            </div>
          </Reveal>

          <Reveal delayMs={440}>
            <p className="mt-8 flex items-baseline gap-1.5 text-sm text-ink/70">
              {/* <Counter> renders "0" first, then animates up to 500 once
                  it's visible — see counter.tsx. */}
              <Counter value={500} suffix="+" className="font-display text-lg font-semibold text-charcoal" />
              gifting programs delivered — see who below.
            </p>
          </Reveal>
        </div>

        {/* Right column: the hero photo. */}
        <Reveal delayMs={200} className="relative">
          <div className="relative aspect-[4/5] w-full max-w-md overflow-hidden rounded-[2rem] shadow-xl shadow-charcoal/10 sm:mx-auto lg:mx-0 lg:ml-auto">
            {/* next/image automatically optimizes images (resizing,
                converting to modern formats like WebP, lazy-loading by
                default). `fill` makes it stretch to cover its parent
                (which is why the parent <div> needs `relative` +
                explicit sizing via `aspect-[4/5]`), and `priority` tells
                Next.js to load THIS particular image as early as possible
                since it's the first thing visible on the page (skipping
                the normal lazy-loading behavior, which is meant for
                images further down the page). `sizes` hints at how large
                the image will actually be displayed at different screen
                widths, so Next.js can pick an appropriately-sized file
                instead of always serving the biggest version. */}
            <Image
              src="https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&w=900&q=80"
              alt="A curated Handpikd corporate gift box being wrapped with ribbon"
              fill
              priority
              sizes="(min-width: 1024px) 420px, (min-width: 640px) 60vw, 90vw"
              className="object-cover"
            />
          </div>
          {/* A small purely-decorative bordered square peeking out from
              behind the photo — hidden from screen readers since it
              conveys no information, and hidden on small screens
              (`hidden sm:block`) where there isn't room for it to look
              intentional. */}
          <div
            aria-hidden="true"
            className="absolute -bottom-6 -left-6 hidden h-28 w-28 rounded-2xl border-2 border-charcoal/15 sm:block"
          />
        </Reveal>
      </div>
    </section>
  );
}
