// ---------------------------------------------------------------------------
// <Reveal> — fade + rise entrance animation on scroll
// ---------------------------------------------------------------------------
// Wrap any content in <Reveal>...</Reveal> and it will fade in and slide up
// slightly the first time it scrolls into view, instead of just appearing
// instantly. Used throughout the section components (hero.tsx, who-we-
// are.tsx, testimonials.tsx, etc.) for badges, paragraphs, and buttons.
//
// This component only toggles a CSS class ("is-visible") — the actual
// animation (what "hidden" and "visible" look like) is defined in
// src/app/globals.css under the `.reveal` / `.reveal.is-visible` rules.
// Splitting it this way (JS decides WHEN, CSS decides WHAT) keeps the
// animation itself easy to tweak without touching this component.

// "use client" is required because this component uses React hooks
// (useState, useEffect, useRef) and a browser-only API
// (IntersectionObserver) — none of that can run on the server.
"use client";

import { useEffect, useRef, useState } from "react";

export function Reveal({
  children,
  delayMs = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delayMs?: number; // how long to wait, in milliseconds, before starting the animation once visible
  className?: string;
  as?: "div" | "li"; // which HTML tag to render as — "li" is needed when Reveal wraps a <ul> item
}) {
  // `ref` will point at the actual DOM node once it's rendered, so the
  // IntersectionObserver below has something concrete to watch.
  const ref = useRef<HTMLDivElement | HTMLLIElement>(null);
  // `visible` starts `false` (hidden) and flips to `true` the first time
  // the element scrolls into the viewport. Once it's `true`, it never goes
  // back to `false` — see the observer.disconnect() call below.
  const [visible, setVisible] = useState(false);

  // `useEffect(fn, [])` with an empty dependency array runs `fn` exactly
  // once, right after this component first renders — a good place to set
  // up things like observers, timers, or event listeners that touch the
  // DOM directly.
  useEffect(() => {
    const node = ref.current;
    if (!node) return; // safety check — ref.current could theoretically be null

    // IntersectionObserver is a built-in browser API that watches an
    // element and calls a callback whenever it enters or leaves the
    // viewport, without the performance cost of listening to every scroll
    // event by hand.
    const observer = new IntersectionObserver(
      ([entry]) => {
        // `entry.isIntersecting` is true once ANY part of the element is
        // visible on screen (subject to the threshold/rootMargin options
        // below).
        if (entry.isIntersecting) {
          setVisible(true);
          // Once revealed, stop watching entirely — this is a one-time
          // entrance animation, not something that should hide again if
          // the user scrolls back up and down past it.
          observer.disconnect();
        }
      },
      {
        threshold: 0.15, // fire once at least 15% of the element is visible
        rootMargin: "0px 0px -40px 0px", // shrink the "visible" zone by 40px from the bottom, so the animation starts slightly before the element reaches the very bottom edge of the screen
      },
    );

    observer.observe(node);

    // The function returned from useEffect is a "cleanup" function — React
    // calls it if the component unmounts before the observer ever fires,
    // so it isn't left running and leaking memory.
    return () => observer.disconnect();
  }, []);

  return (
    // `Tag` is a variable holding a string ("div" or "li"), used here as a
    // DYNAMIC component name — writing `<Tag>` (capitalized variable) tells
    // React/JSX "render whatever HTML tag this variable currently holds,"
    // which is how the same component can render either a <div> or an <li>
    // depending on the `as` prop.
    <Tag
      ref={ref as never}
      // Always has the "reveal" class (defining the hidden starting state
      // in CSS); adds "is-visible" once the element has been seen, which
      // switches it to the visible/animated-in end state.
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      // Inline style for the animation's start delay. Setting it to "0ms"
      // while still hidden (and only applying the real delay once visible)
      // avoids an awkward pause before the FIRST time the element appears.
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
    >
      {children}
    </Tag>
  );
}
