// ---------------------------------------------------------------------------
// Shared GSAP setup
// ---------------------------------------------------------------------------
// GSAP (GreenSock Animation Platform) is the animation library this project
// uses for anything scroll-driven (the price slider's number counting up,
// image/card reveal effects, etc.) — see counter.tsx, who-we-are.tsx, and
// testimonials.tsx for components that use it.
//
// Every file that needs GSAP imports it from HERE (`@/lib/gsap`) instead of
// importing directly from the "gsap" package. That's so the ScrollTrigger
// plugin (GSAP's add-on for triggering animations based on scroll position)
// only gets registered ONCE, no matter how many components use it.

// "use client" marks this as a Client Component boundary for Next.js's App
// Router. Next.js renders components on the SERVER by default; anything
// that touches browser-only APIs (like `window`, used below) must opt into
// running in the browser instead. Any file that imports from this module
// automatically becomes part of that client-side boundary too.
"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Next.js runs this module's top-level code both on the server (during
// server-side rendering) and in the browser. `window` doesn't exist on the
// server, so registering a browser-only plugin unconditionally would crash
// during server rendering. This check ("does `window` exist?") only lets
// the registration run in an actual browser.
if (typeof window !== "undefined") {
  // Plugins are "off" by default in GSAP until explicitly turned on. This
  // line enables ScrollTrigger (letting any `scrollTrigger: {...}` option
  // work in animations elsewhere in the codebase).
  gsap.registerPlugin(ScrollTrigger);
}

// Re-export both so other files can write:
//   import { gsap, ScrollTrigger } from "@/lib/gsap";
// instead of importing from the raw "gsap" package directly.
export { gsap, ScrollTrigger };
