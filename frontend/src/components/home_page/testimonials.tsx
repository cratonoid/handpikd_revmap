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
import { Eyebrow } from "@/components/eyebrow";
import { QuoteIcon } from "@/components/icons";
import styles from "@/styles/home-page.module.css";

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

// One CSS class per avatar tone, cycled through below with
// `avatarTones[i % avatarTones.length]` so the 3 testimonial cards each get
// a visually distinct (but still on-brand) initials badge instead of all
// looking identical. See `.avatarToneDark` / `.avatarToneRed` /
// `.avatarToneBeige` in home-page.module.css.
const avatarTones = [styles.avatarToneDark, styles.avatarToneRed, styles.avatarToneBeige];

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
    <section className={styles.testimonialsSection}>
      <div className={styles.testimonialsInner}>
        <Reveal className={styles.testimonialsHeader}>
          <Eyebrow>Client Feedback</Eyebrow>
          <h2 className={styles.testimonialsHeading}>What our partners say</h2>
        </Reveal>

        {/* `ref={gridRef}` is what the GSAP effect above uses to find the
            cards inside it via querySelectorAll. 1 column on mobile, 3
            columns from the `md` breakpoint up. */}
        <div ref={gridRef} className={styles.testimonialsGrid}>
          {testimonials.map((t, i) => (
            <figure key={t.name} data-testimonial-card className={styles.testimonialsCard}>
              <QuoteIcon className={styles.testimonialsQuoteIcon} />
              <blockquote className={styles.testimonialsQuote}>&ldquo;{t.quote}&rdquo;</blockquote>
              <figcaption className={styles.testimonialsFooter}>
                {/* The colored circle showing the person's initials, e.g.
                    "PS" for Priya Shah — used instead of a real headshot
                    photo (there isn't one for a placeholder testimonial).
                    `i % avatarTones.length` cycles through the 3 color
                    options above regardless of how many testimonials exist. */}
                <span
                  className={`${styles.testimonialsAvatar} ${avatarTones[i % avatarTones.length]}`}
                  aria-hidden="true" // decorative — the person's real name is printed as text right next to it
                >
                  {t.initials}
                </span>
                <div>
                  <p className={styles.testimonialsName}>{t.name}</p>
                  <p className={styles.testimonialsTitle}>{t.title}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
