"use client";

// Real Handpikd mark (public/logo-mark.png, cropped from the brand logo,
// transparent background) paired with the site's own type for the
// wordmark. The mark is a flat raster image, so it's always rendered in its
// original black — there's currently no section dark enough to need a
// light-colored variant of it (the `variant` prop still recolors the text).
import Image from "next/image";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";

function AnimatedLogoMark({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  const play = () => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.killTweensOf(el);
    gsap.fromTo(
      el,
      { scale: 1, rotate: 0 },
      { scale: 1.12, rotate: -6, duration: 0.22, ease: "power2.out", yoyo: true, repeat: 1 },
    );
  };

  useGSAP(
    () => {
      const timer = window.setTimeout(play, 350);
      return () => window.clearTimeout(timer);
    },
    { scope: ref },
  );

  return (
    <span
      ref={ref}
      onMouseEnter={play}
      className={`relative inline-block shrink-0 will-change-transform ${className}`}
    >
      <Image src="/logo-mark.png" alt="" fill sizes="40px" className="object-contain" />
    </span>
  );
}

export function Logo({
  variant = "dark",
  compact = false,
  className = "",
}: {
  variant?: "dark" | "light";
  compact?: boolean;
  className?: string;
}) {
  const tone = variant === "dark" ? "text-charcoal" : "text-cream";
  return (
    <span className={`inline-flex items-center gap-2.5 ${tone} ${className}`}>
      <AnimatedLogoMark className={`transition-all duration-300 ease-out ${compact ? "h-7 w-7" : "h-9 w-9"}`} />
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
