"use client";

// ---------------------------------------------------------------------------
// <Counter> — animates a number counting up from 0 once it's on screen
// ---------------------------------------------------------------------------
// Used for stats like "500+" (Hero, Who We Are). Renders "0" at first, then
// smoothly counts up to the real `value` the first time it scrolls into
// view. Purely a visual flourish — GSAP is doing all the animation work, not
// React re-rendering; React only renders the component once.
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";

export function Counter({
  value, // the final number to count up to, e.g. 500
  suffix = "", // text appended after the number, e.g. "+" or "hr"
  prefix = "", // text prepended before the number, e.g. "$"
  className = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // `useGSAP` (from the official @gsap/react package) is a hook that's
  // basically "useEffect, but built for GSAP": it runs the function you
  // give it once, and — crucially — automatically cleans up every
  // animation/ScrollTrigger created inside it if the component unmounts,
  // so you don't have to remember to do that by hand.
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      // `gsap.matchMedia()` is GSAP's version of a CSS media query, but for
      // JavaScript animation logic. `.add()` below takes an object of named
      // conditions and only runs the matching branch — this lets the SAME
      // component define two different behaviors (animate vs. don't) based
      // on the user's OS-level "reduce motion" accessibility setting,
      // without manually writing `window.matchMedia(...)` checks.
      const mm = gsap.matchMedia();
      mm.add(
        {
          reduceMotion: "(prefers-reduced-motion: reduce)",
          animate: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          // `context.conditions` tells us which named condition(s) from
          // above are currently true. Here we only care whether the user
          // wants reduced motion.
          const { reduceMotion } = context.conditions as { reduceMotion: boolean };

          if (reduceMotion) {
            // Skip the animation entirely — just show the final number
            // immediately. This is the accessible fallback.
            el.textContent = `${prefix}${value}${suffix}`;
            return;
          }

          // GSAP can only animate NUMERIC properties, and a <span>'s text
          // content isn't one — so instead we animate a plain, throwaway
          // JavaScript object `{ n: 0 }`, and manually copy its value into
          // the DOM on every animation frame via `onUpdate`. This "tween a
          // fake object, read it in onUpdate" pattern is a common GSAP
          // trick for animating things GSAP can't touch directly (like
          // text, or driving your own custom logic off an eased value).
          const counter = { n: 0 };
          gsap.to(counter, {
            n: value, // animate counter.n from 0 up to `value`
            duration: 1.4, // seconds
            ease: "power2.out", // starts fast, eases to a gentle stop
            scrollTrigger: {
              trigger: el, // start watching when THIS element enters the viewport
              start: "top 90%", // "fire when the element's top edge reaches 90% down the viewport" (i.e. just as it starts coming into view)
              // toggleActions has 4 slots — one action for each of:
              // onEnter, onLeave, onEnterBack, onLeaveBack. "play none none
              // none" means: play the animation forward once when it first
              // scrolls into view, and do nothing (no replay, no reverse)
              // for every other scroll event afterward.
              toggleActions: "play none none none",
            },
            onUpdate: () => {
              // Runs on every animation frame while `counter.n` is
              // changing. `Math.round` avoids showing decimals like
              // "247.83" mid-animation.
              el.textContent = `${prefix}${Math.round(counter.n)}${suffix}`;
            },
          });
        },
      );

      // useGSAP's own cleanup already reverts everything created inside it
      // automatically, but calling `mm.revert()` explicitly here is the
      // documented way to also clean up the matchMedia listeners
      // themselves when the component unmounts.
      return () => mm.revert();
    },
    { scope: ref }, // limits GSAP's internal selectors to only look inside this element — not required here since we use refs directly, but a good habit
  );

  return (
    // Rendered once by React with the STARTING value (0); GSAP takes over
    // updating this element's text directly afterward, bypassing React.
    <span ref={ref} className={className}>
      {prefix}0{suffix}
    </span>
  );
}
