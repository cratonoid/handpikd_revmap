"use client";

// ---------------------------------------------------------------------------
// <Logo> — the Handpikd mark + wordmark, used in the Header and Footer
// ---------------------------------------------------------------------------
// The logo IMAGE (public/logo-mark.png) is a real cropped export of the
// brand's circular gift-and-hand mark. The word "HANDPIKD" next to it is
// NOT part of that image — it's rendered as real HTML text in the site's own
// heading font, so it stays crisp at any size and can change color to match
// light/dark backgrounds (an image can't do that as easily).
//
// The image itself is flat black pixels on a transparent background. On a
// DARK section (like the black Footer), plain black would be invisible, so
// this component uses a CSS `invert` filter to flip it to white instead of
// needing a second "light mode" image file.
import Image from "next/image";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";

// The animated icon half of the logo, split into its own small component so
// <Logo> itself (below) can stay focused on the wordmark/layout, and so this
// piece could be reused elsewhere later without the text next to it.
function AnimatedLogoMark({ className = "", invert = false }: { className?: string; invert?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  // A small "play this animation" function, rather than something baked
  // directly into useGSAP, so it can be triggered from TWO different
  // places: once automatically after the page loads (see useGSAP below),
  // and again every time the user hovers over the logo (see onMouseEnter
  // in the JSX).
  const play = () => {
    const el = ref.current;
    // Bail out early if there's nothing to animate, OR if the user's OS
    // has "reduce motion" turned on (checked directly with
    // `window.matchMedia` here, since this is a plain function rather than
    // a GSAP-managed effect where `gsap.matchMedia()` would normally be
    // used — see split-reveal.tsx / counter.tsx for that pattern).
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Stops any animation already running on this element. Needed because
    // `play` can be called again (via hover) before a previous run has
    // finished — without this, overlapping animations could fight each
    // other and look glitchy.
    gsap.killTweensOf(el);

    // `gsap.fromTo(target, fromState, toState)` animates explicitly FROM
    // one set of values TO another (as opposed to `gsap.to`, which
    // animates from wherever the element currently is). `yoyo: true` +
    // `repeat: 1` makes it play forward once, then automatically reverse
    // back to the starting state — a quick "pop and settle" wiggle.
    gsap.fromTo(
      el,
      { scale: 1, rotate: 0 },
      { scale: 1.12, rotate: -6, duration: 0.22, ease: "power2.out", yoyo: true, repeat: 1 },
    );
  };

  useGSAP(
    () => {
      // Wait 350ms after the component mounts, then play the little
      // "welcome" wiggle once automatically (giving the page a moment to
      // settle in first). `window.setTimeout` returns an id you can cancel
      // with `clearTimeout` — doing that in the cleanup function prevents
      // the animation from firing after the component has already been
      // removed from the page (e.g. if the user navigates away fast).
      const timer = window.setTimeout(play, 350);
      return () => window.clearTimeout(timer);
    },
    { scope: ref },
  );

  return (
    <span
      ref={ref}
      onMouseEnter={play} // replay the wiggle every time the mouse enters the logo
      className={`relative inline-block shrink-0 will-change-transform ${className}`}
    >
      {/* next/image's `fill` mode makes the image stretch to completely
          fill its nearest positioned parent (hence `relative` on the <span>
          above) instead of needing explicit width/height numbers — handy
          here since this logo renders at different sizes (see the
          `compact` prop below). `sizes="40px"` tells Next.js roughly how
          large this image will actually be displayed, so it can generate
          an appropriately small optimized file instead of shipping a huge
          one. The `invert` Tailwind class applies `filter: invert(1)`,
          which flips black pixels to white (and vice versa) — that's the
          "no second image file needed" trick mentioned above. */}
      <Image
        src="/logo-mark.png"
        alt="" // decorative — the visible "Handpikd" text right next to it already conveys the brand name to screen readers
        fill
        sizes="40px"
        className={`object-contain ${invert ? "invert" : ""}`}
      />
    </span>
  );
}

export function Logo({
  variant = "dark", // "dark" = charcoal text for light backgrounds; "light" = cream text + inverted (white) logo mark, for dark backgrounds
  compact = false, // true = render smaller (used by the header once it shrinks on scroll — see header.tsx)
  className = "",
}: {
  variant?: "dark" | "light";
  compact?: boolean;
  className?: string;
}) {
  const tone = variant === "dark" ? "text-charcoal" : "text-cream";
  return (
    <span className={`inline-flex items-center gap-2.5 ${tone} ${className}`}>
      <AnimatedLogoMark
        invert={variant === "light"}
        // `transition-all duration-300` animates the size change smoothly
        // whenever `compact` flips (e.g. as the header shrinks on scroll),
        // instead of jumping instantly between the two sizes.
        className={`transition-all duration-300 ease-out ${compact ? "h-7 w-7" : "h-9 w-9"}`}
      />
      <span
        className={`font-display font-semibold tracking-[0.18em] uppercase transition-all duration-300 ease-out ${
          compact ? "text-sm" : "text-lg"
        }`}
      >
        Handpikd
      </span>
    </span>
  );
}
