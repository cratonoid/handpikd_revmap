"use client";

// ---------------------------------------------------------------------------
// <WhoWeAre> — the "about" section (id="who-we-are", linked from the nav)
// ---------------------------------------------------------------------------
// Two-column layout: company description + stats on one side, a photo on
// the other. Needs "use client" specifically because of the GSAP
// scroll-driven image reveal effect below (everything else in this file
// could be server-rendered on its own).
//
// Styling lives in src/styles/home-page.module.css — see the big comment at
// the top of hero.tsx for how CSS Modules work in this project.
import { useRef } from "react";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { Reveal } from "@/components/reveal";
import { Eyebrow } from "@/components/eyebrow";
import { Counter } from "@/components/counter";
import styles from "@/styles/home-page.module.css";

// Headline stats from Handpikd's track record — each counts up from 0 once
// scrolled into view (see counter.tsx). Update these numbers as the business
// grows.
const stats = [
  { value: 50, suffix: "+", label: "Happy Clients" },
  { value: 500, suffix: "+", label: "Gifts Delivered" },
  { value: 100, suffix: "%", label: "Satisfaction Rate" },
];

export function WhoWeAre() {
  const imageWrapRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = imageWrapRef.current;
    if (!el) return;

    const mm = gsap.matchMedia();
    mm.add({ animate: "(prefers-reduced-motion: no-preference)" }, () => {
      // `gsap.fromTo(target, fromState, toState)` animates the image
      // wrapper from a "zoomed in and inset/cropped" starting state to its
      // normal full-size, uncropped resting state, as the user scrolls it
      // into view. `clipPath: inset(12% 12% 12% 12% round 1.5rem)` crops
      // 12% off each edge (with rounded corners); animating that down to
      // `inset(0% 0% 0% 0%)` makes the crop appear to "expand outward" to
      // reveal the full photo. Combined with the scale going from 1.08 down
      // to 1 (very slightly zoomed in -> normal size), it reads as the
      // image gently "settling into place."
      gsap.fromTo(
        el,
        { clipPath: "inset(12% 12% 12% 12% round 1.5rem)", scale: 1.08 },
        {
          clipPath: "inset(0% 0% 0% 0% round 1.5rem)",
          scale: 1,
          ease: "none", // no easing curve — see the note on `scrub` below for why
          scrollTrigger: {
            trigger: el,
            start: "top 90%", // begin animating once the image's top edge is 90% down the viewport (just barely visible)
            end: "top 35%", // finish once its top edge reaches 35% down the viewport
            // `scrub: 1` ties the animation's progress DIRECTLY to scroll
            // position (rather than playing once on a timer) — scrolling
            // down plays it forward, scrolling back up reverses it, at
            // whatever pace the user scrolls. The `1` adds a small 1-second
            // "catch-up" smoothing so it doesn't feel too instantaneous/
            // jerky. Because the animation's timing is entirely driven by
            // scroll position rather than a fixed duration, `ease: "none"`
            // (linear) is used — an eased eased curve would fight with the
            // scrub's own smoothing.
            scrub: 1,
          },
        },
      );
    });

    return () => mm.revert();
  }, { scope: imageWrapRef });

  return (
    // `id="who-we-are"` is the anchor target for the "About" nav link
    // ("/#who-we-are" in brand.ts) — clicking that link scrolls the page to
    // this exact element.
    <section id="who-we-are" className={styles.whoSection}>
      <div className={styles.whoInner}>
        {/* `.whoTextCol` / `.whoImageCol` swap their `order` depending on
            screen size: on mobile (stacked), the photo appears ABOVE the
            text; on large screens (side-by-side), the text sits on the
            LEFT and the photo on the RIGHT. This is a common trick for
            reordering content responsively without duplicating any
            markup. */}
        <Reveal className={styles.whoTextCol}>
          <Eyebrow>Who We Are</Eyebrow>
          <h2 className={styles.whoHeading}>Crafting memorable experiences.</h2>
          <p className={styles.whoParagraph}>
            At Handpikd, we understand that every corporate gift tells a
            story. Based in Bangalore, our mission is to help businesses
            across Karnataka and India forge stronger relationships through
            thoughtfully curated, premium business gifts that resonate with
            recipients and reflect your brand identity.
          </p>
          <p className={styles.whoParagraph}>
            With years of expertise in corporate gifting, we specialize in
            bespoke gift packages for employee recognition, client
            appreciation, and business events. Serving companies throughout
            Bangalore with same-day delivery options, every order is
            handpikd, packed, and tracked by a dedicated account team.
          </p>

          <dl className={styles.whoStats}>
            {stats.map((stat) => (
              <div key={stat.label} className={styles.whoStatItem}>
                <dd className={styles.whoStatNumber}>
                  <Counter value={stat.value} suffix={stat.suffix} />
                </dd>
                <dt className={styles.whoStatLabel}>{stat.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>

        <div className={styles.whoImageCol}>
          <div
            ref={imageWrapRef} // this is the element the GSAP effect above animates
            className={styles.whoImageBox}
          >
            <Image
              src="https://images.unsplash.com/photo-1513885535751-8b9238bd345a?auto=format&fit=crop&w=1000&q=80"
              alt="Premium luxury corporate gift box with custom wrapping and branded merchandise"
              fill
              sizes="(min-width: 1024px) 520px, 90vw"
              className={styles.whoImageFill}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
