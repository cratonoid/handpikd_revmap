"use client";

import { useRef } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { Reveal } from "@/components/reveal";
import { SplitReveal } from "@/components/split-reveal";
import { Eyebrow } from "@/components/eyebrow";
import { Counter } from "@/components/counter";

const stats = [
  { value: 500, suffix: "+", label: "Gifting programs delivered" },
  { value: 50, suffix: "", label: "US states shipped to" },
  { value: 12, suffix: "hr", label: "Avg. account manager response" },
];

export function WhoWeAre() {
  const imageWrapRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = imageWrapRef.current;
    if (!el) return;

    const mm = gsap.matchMedia();
    mm.add({ animate: "(prefers-reduced-motion: no-preference)" }, () => {
      gsap.fromTo(
        el,
        { clipPath: "inset(12% 12% 12% 12% round 1.5rem)", scale: 1.08 },
        {
          clipPath: "inset(0% 0% 0% 0% round 1.5rem)",
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
            end: "top 35%",
            scrub: 1,
          },
        },
      );
    });

    return () => mm.revert();
  }, { scope: imageWrapRef });

  return (
    <section id="who-we-are" className="bg-cream-deep">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <Eyebrow>Who We Are</Eyebrow>
          <SplitReveal
            as="h2"
            text="Corporate gifting, run like a program — not a scramble."
            className="mt-4 font-display text-3xl font-semibold text-charcoal sm:text-4xl"
          />
          <p className="mt-5 leading-relaxed text-ink">
            Handpikd is a B2B corporate gifting company. We partner with
            procurement, HR, and marketing teams to design gifting programs
            that reflect their brand — then handle sourcing, personalization,
            warehousing, and nationwide fulfillment so nothing lands back on
            your plate.
          </p>
          <p className="mt-4 leading-relaxed text-ink">
            Whether it&apos;s a single high-touch executive gift or a
            multi-thousand-recipient rollout, every order is handpikd,
            packed, and tracked by a dedicated account team.
          </p>

          <dl className="mt-9 grid grid-cols-3 gap-6 border-t border-charcoal/15 pt-8">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd className="font-display text-2xl font-semibold text-charcoal sm:text-3xl">
                  <Counter value={stat.value} suffix={stat.suffix} />
                </dd>
                <p className="mt-1 text-xs leading-snug text-ink/70">{stat.label}</p>
              </div>
            ))}
          </dl>
        </Reveal>

        <div className="order-1 lg:order-2">
          <div
            ref={imageWrapRef}
            className="relative aspect-[5/4] w-full overflow-hidden rounded-[1.5rem] shadow-lg shadow-charcoal/10 will-change-transform"
          >
            <Image
              src="https://images.unsplash.com/photo-1573167243872-43c6433b9d40?auto=format&fit=crop&w=1000&q=80"
              alt="Handpikd account team reviewing a corporate gifting program"
              fill
              sizes="(min-width: 1024px) 520px, 90vw"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
