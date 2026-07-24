"use client";

// ---------------------------------------------------------------------------
// <SplitReveal> — headings that rise in word-by-word on scroll
// ---------------------------------------------------------------------------
// This is the effect used on most section headings across the site (e.g.
// "Corporate gifts people actually want to open." in the Hero). Instead of
// the whole heading fading in as one block, each WORD slides up into place
// individually, one after another, giving a more polished "typewriter-ish"
// entrance.
//
// How the visual trick works, in plain terms:
//   1. Each word is wrapped in two nested <span>s. The OUTER span has
//      `overflow-hidden` and a fixed height (its own line height), acting
//      like a little window/mask. The INNER span holds the actual word text.
//   2. Before the animation runs, the inner span is pushed DOWN out of view
//      (`yPercent: 110` — 110% of its own height, so it's fully below the
//      outer span's visible window) and made transparent.
//   3. The animation slides the inner span back up to its natural position
//      (`yPercent: 0`) while fading it in. Because the outer span clips
//      anything outside its box, this reads as the word "rising up from
//      behind a mask" rather than just sliding across the page.
//   4. `stagger` delays each word's animation slightly after the previous
//      one, so they don't all move at once.
//
// Falls back to fully visible, unmasked text for prefers-reduced-motion
// (handled inside the matchMedia block below).
import { useRef, Fragment } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";

// A small custom TypeScript type listing exactly which HTML tags this
// component is allowed to render as — restricts the `as` prop below to only
// these four options instead of accepting any arbitrary string.
type Tag = "h1" | "h2" | "h3" | "p";

export function SplitReveal({
  text, // the plain text to render and animate, e.g. "Who We Are"
  as: Tag = "h2", // which heading level to render — renamed to capital `Tag` so it can be used as a JSX component below
  className = "",
  delay = 0, // extra delay, in MILLISECONDS, before this heading's words start animating (handy for staggering multiple SplitReveals on the same page)
  start = "top 85%", // ScrollTrigger's "start" position — see the comment further down
}: {
  text: string;
  as?: Tag;
  className?: string;
  delay?: number;
  start?: string;
}) {
  const ref = useRef<HTMLHeadingElement | HTMLParagraphElement>(null);
  // Splitting on a plain space (" ") turns "Who We Are" into
  // ["Who", "We", "Are"] — one entry per word to render/animate separately.
  const words = text.split(" ");

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();

      mm.add(
        {
          reduceMotion: "(prefers-reduced-motion: reduce)",
          animate: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          const { reduceMotion } = context.conditions as { reduceMotion: boolean };
          // Find every "inner word span" inside this heading. `[data-word-
          // inner]` is a CSS attribute selector matching any element with a
          // `data-word-inner` attribute — see the JSX below where it's set.
          const inner = el.querySelectorAll<HTMLElement>("[data-word-inner]");

          if (reduceMotion) {
            // Reduced-motion users just see the words already in their
            // final resting position — no masking, no animation.
            gsap.set(inner, { yPercent: 0, opacity: 1 });
            return;
          }

          // `gsap.set(...)` applies values IMMEDIATELY, with no animation —
          // this establishes the "hidden" starting state described above
          // (pushed down 110% and invisible) before the real animation
          // below eases it back to the visible resting state.
          gsap.set(inner, { yPercent: 110, opacity: 0 });
          gsap.to(inner, {
            yPercent: 0,
            opacity: 1,
            duration: 0.8,
            ease: "power3.out",
            stagger: 0.045, // each word starts 45ms after the previous one
            delay: delay / 1000, // GSAP's `delay` is in SECONDS, but the `delay` prop is documented in milliseconds, so convert here
            scrollTrigger: {
              trigger: el,
              start, // e.g. "top 85%" = fire once this heading's top edge reaches 85% down the viewport (i.e. it's mostly on screen)
              toggleActions: "play none none none", // play once on the way down, never reverse/replay after that
            },
          });
        },
      );

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    // `Tag` here is the capitalized prop from above, used as a dynamic JSX
    // tag name (see reveal.tsx for the same pattern).
    <Tag ref={ref as never} className={className}>
      {words.map((word, i) => (
        // `<Fragment>` groups the mask span + a following space character
        // together without adding an extra real DOM element for each word.
        // `key` is required by React whenever you render a list with
        // `.map()`, so it can track which item is which across re-renders;
        // `${word}-${i}` is used instead of just `word` in case the same
        // word appears twice in the sentence (keys must be unique among
        // siblings).
        <Fragment key={`${word}-${i}`}>
          {/* The "mask": overflow-hidden clips anything outside its box.
              `align-bottom` plus the small padding/negative-margin pair
              keeps letters with descenders (like "g" or "y") from getting
              visually clipped at the bottom edge of the mask. */}
          <span className="inline-block overflow-hidden align-bottom pb-[0.1em] -mb-[0.1em]">
            {/* The actual word. `data-word-inner` is a custom HTML data
                attribute — it has no built-in meaning to the browser, it
                exists purely so the GSAP code above can select these
                specific spans with `querySelectorAll("[data-word-inner]")`.
                `will-change-transform` is a performance hint telling the
                browser "this element's transform is about to be animated a
                lot, so set up GPU acceleration for it in advance." */}
            <span data-word-inner className="inline-block will-change-transform">
              {word}
            </span>
          </span>
          {/* Add a real space after every word except the last one, so the
              rendered text still wraps and reads normally. */}
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </Tag>
  );
}
