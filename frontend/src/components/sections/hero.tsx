"use client";

import { useRef } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { Button } from "@/components/button";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Counter } from "@/components/counter";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      if (!section) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          animate: "(prefers-reduced-motion: no-preference)",
        },
        () => {
          // Weighted parallax exit: text, image, and background blobs drift
          // at different speeds as the hero scrolls past — the "drag" feel.
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: "bottom top",
              scrub: 1,
            },
          });

          tl.to(textRef.current, { yPercent: -35, opacity: 0.25, ease: "none" }, 0)
            .to(imageRef.current, { yPercent: -12, ease: "none" }, 0)
            .to(blobRef.current, { yPercent: -55, ease: "none" }, 0);

          gsap.to(blobRef.current, {
            x: 18,
            y: -14,
            duration: 6,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
          });
        },
      );

      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="relative overflow-hidden">
      <div
        ref={blobRef}
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-cream-deep/50 blur-3xl will-change-transform"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -left-28 h-72 w-72 rounded-full bg-charcoal/[0.04] blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
        <div ref={textRef} className="will-change-transform">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-white/70 px-4 py-1.5 text-xs font-semibold tracking-[0.14em] text-charcoal/80 uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-red" />
              B2B Corporate Gifting, Done Differently
            </span>
          </Reveal>

          <SplitReveal
            as="h1"
            text="Corporate gifts people actually want to open."
            delay={80}
            className="mt-6 font-display text-4xl leading-[1.08] font-semibold text-charcoal sm:text-5xl lg:text-[3.5rem]"
          />

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
              <Counter value={500} suffix="+" className="font-display text-lg font-semibold text-charcoal" />
              gifting programs delivered — see who below.
            </p>
          </Reveal>
        </div>

        <Reveal delayMs={200} className="relative">
          <div
            ref={imageRef}
            className="relative aspect-[4/5] w-full max-w-md overflow-hidden rounded-[2rem] shadow-xl shadow-charcoal/10 will-change-transform sm:mx-auto lg:mx-0 lg:ml-auto"
          >
            <Image
              src="https://images.unsplash.com/photo-1573164713988-8665fc963095?auto=format&fit=crop&w=900&q=80"
              alt="A curated Handpikd corporate gift box being wrapped with ribbon"
              fill
              priority
              sizes="(min-width: 1024px) 420px, (min-width: 640px) 60vw, 90vw"
              className="object-cover"
            />
          </div>
          <div
            aria-hidden="true"
            className="absolute -bottom-6 -left-6 hidden h-28 w-28 rounded-2xl border-2 border-charcoal/15 sm:block"
          />
        </Reveal>
      </div>
    </section>
  );
}
