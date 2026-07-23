"use client";

// Word-by-word "text graphic" reveal: each word is masked inside an
// overflow-hidden span and rises into place as the element scrolls into
// view. Falls back to fully visible, unmasked text for
// prefers-reduced-motion (handled inside the matchMedia block below).
import { useRef, Fragment } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";

type Tag = "h1" | "h2" | "h3" | "p";

export function SplitReveal({
  text,
  as: Tag = "h2",
  className = "",
  delay = 0,
  start = "top 85%",
}: {
  text: string;
  as?: Tag;
  className?: string;
  delay?: number;
  start?: string;
}) {
  const ref = useRef<HTMLHeadingElement | HTMLParagraphElement>(null);
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
          const inner = el.querySelectorAll<HTMLElement>("[data-word-inner]");

          if (reduceMotion) {
            gsap.set(inner, { yPercent: 0, opacity: 1 });
            return;
          }

          gsap.set(inner, { yPercent: 110, opacity: 0 });
          gsap.to(inner, {
            yPercent: 0,
            opacity: 1,
            duration: 0.8,
            ease: "power3.out",
            stagger: 0.045,
            delay: delay / 1000,
            scrollTrigger: {
              trigger: el,
              start,
              toggleActions: "play none none none",
            },
          });
        },
      );

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref as never} className={className}>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="inline-block overflow-hidden align-bottom pb-[0.1em] -mb-[0.1em]">
            <span data-word-inner className="inline-block will-change-transform">
              {word}
            </span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </Tag>
  );
}
