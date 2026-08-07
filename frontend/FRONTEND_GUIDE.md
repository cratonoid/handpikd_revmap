# Handpikd Frontend — A Learning Guide

This document explains **how the frontend is built and why**, aimed at
someone learning frontend development who wants to understand this codebase
well enough to confidently fix or extend it. Every source file also has
inline comments explaining what individual lines/blocks do — start here for
the big picture, then open the actual file for line-by-line detail.

> For a terser, reference-style overview of the whole repo (frontend +
> backend + database), see [`../APPLICATION_ARCHITECTURE.md`](../APPLICATION_ARCHITECTURE.md)
> and [`../SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md) — heads up
> that as of this writing those two files describe the frontend at its very
> early "scaffold" stage and haven't been updated to reflect everything
> below; this guide is the current, detailed source of truth for `frontend/`.

---

## 1. Tech stack

| Piece | What it is | Why it's here |
|---|---|---|
| **Next.js 16** (App Router) | A React framework that handles routing, rendering, and build tooling | Gives us file-based routing, Server Components, image optimization, and font loading out of the box |
| **React 19** | The UI library Next.js is built on | Components, hooks, state |
| **TypeScript** | JavaScript + static types | Catches typos/type mistakes (e.g. passing a string where a number is expected) before the code even runs |
| **Tailwind CSS v4** | Utility-class CSS framework | Styling is done with classes like `flex`, `text-lg`, `bg-cream` directly in JSX, instead of separate `.css` files per component |
| **GSAP** (`gsap` + `@gsap/react`) | A JavaScript animation library, with its **ScrollTrigger** plugin | Powers every scroll-linked animation (word-by-word text reveals, counters, image reveals) |

The project was bootstrapped with `create-next-app` and still carries a
warning in `AGENTS.md`/`CLAUDE.md`: **this Next.js version may have breaking
changes vs. older tutorials/training data** — when in doubt about a Next.js
API, check `node_modules/next/dist/docs/` rather than assuming.

### Why no separate CSS files per component?

Tailwind CSS works by scanning every `.tsx` file for class names (like
`className="flex items-center gap-4"`) and generating exactly the CSS
needed for the classes actually used. There's no `Header.module.css` or
similar anywhere in this project — styling lives directly alongside the
markup it styles, in the `className` props. The one real stylesheet,
[`src/app/globals.css`](src/app/globals.css), only contains things Tailwind
utility classes *can't* express: the color palette definitions, and a
handful of hand-written CSS rules for effects Tailwind has no built-in
utility for (the scroll-reveal animation, the logo marquee loop, the custom
dual-handle price slider).

---

## 2. Folder structure

```
frontend/
  public/                     Static files served as-is at the site root
    logo-mark.png              The real Handpikd logo icon (cropped, transparent bg)
    logo.png                   The original full logo file (icon + wordmark stacked)
    *.svg                      Unused create-next-app starter icons (safe to delete)

  src/
    app/                       ROUTES — see "Routing" below
      layout.tsx                Root layout: <html>/<body>, fonts, global <head> metadata
      page.tsx                  Homepage ("/")
      globals.css                Tailwind import + color variables + hand-written CSS
      products/
        page.tsx                 "/products" — the shop page
      blogs/
        page.tsx                  "/blogs" — placeholder page

    components/                Reusable UI pieces, NOT tied to a specific route
      button.tsx                 <Button> — the one reusable button/link component
      header.tsx                 <Header> — sticky top nav
      footer.tsx                 <Footer> — site-wide footer
      logo.tsx                   <Logo> — icon + wordmark, used in Header & Footer
      icons.tsx                  Hand-drawn SVG icon set
      company-logos.tsx          Placeholder "client logo" marks for the marquee
      eyebrow.tsx                 <Eyebrow> — small uppercase label above headings
      coming-soon.tsx             <ComingSoon> — shared placeholder-page layout
      reveal.tsx                  <Reveal> — fade/rise-in-on-scroll wrapper
      split-reveal.tsx            <SplitReveal> — word-by-word heading reveal
      counter.tsx                 <Counter> — animated "count up" number

      home_page/                 One file per homepage section, in page order
        hero.tsx
        who-we-are.tsx
        client-marquee.tsx
        what-we-offer.tsx
        testimonials.tsx
        connect.tsx
        contact-form.tsx          (used inside connect.tsx)

      products/                  Everything specific to the /products page
        products-page-client.tsx  The "brain" — owns all filter state
        category-filter.tsx        Recursive category checkbox tree
        price-filter.tsx           Dual-handle price range slider
        product-card.tsx           One grid item
        add-to-gift-list-button.tsx  The small CTA on each card

    lib/                        Non-visual logic: data, config, shared setup
      brand.ts                   Color hex values + site config (nav links, contact info)
      products-data.ts           The product catalogue: category tree + generated product list
      gsap.ts                    One-time GSAP/ScrollTrigger setup, re-exported from here

  next.config.ts                 Next.js configuration (allowed external image hosts, etc.)
  eslint.config.mjs               Linting rules
  tsconfig.json                   TypeScript configuration (includes the "@/*" import alias)
  package.json                    Dependencies + npm scripts
```

### The `@/` import alias

Every file imports from paths like `import { Button } from "@/components/button"`
instead of a relative path like `../../components/button`. `@/` is a shortcut
configured in `tsconfig.json` that always points at `src/`, no matter how
deeply nested the importing file is — it saves you from counting `../`s and
makes imports resilient to moving a file to a different folder.

---

## 3. Routing (the App Router)

Next.js's **App Router** uses the *filesystem* as the router: a file named
exactly `page.tsx` inside `src/app/` becomes a real URL route, based on its
folder path.

| File | URL |
|---|---|
| `src/app/page.tsx` | `/` (the homepage) |
| `src/app/products/page.tsx` | `/products` |
| `src/app/blogs/page.tsx` | `/blogs` |

To add a new route, e.g. an "About" page at `/about`, you'd create
`src/app/about/page.tsx` exporting a default React component — Next.js
handles wiring it up automatically, no router config file to edit.

`src/app/layout.tsx` is special: it wraps **every** page (see the big
comment at the top of that file). It's where the `<html>`/`<body>` tags,
global fonts, and default page metadata (`<title>`, `<meta description>`)
live, since those need to be identical everywhere.

---

## 4. Server Components vs. Client Components

This is the single most important React/Next.js concept in this codebase,
and it's why some files start with `"use client";` at the very top and
others don't.

- **Server Components** (the default — no directive needed) render on the
  server (or at build time) and send plain HTML to the browser. They can't
  use React state (`useState`), effects (`useEffect`), refs, or any
  browser-only API (`window`, `document`). Most of the section components
  (`hero.tsx`, `client-marquee.tsx`, `what-we-offer.tsx`, `connect.tsx`,
  `footer.tsx`, `eyebrow.tsx`, `coming-soon.tsx`, `icons.tsx`) are Server
  Components — they just describe static markup.
- **Client Components** (marked with `"use client";` at the top of the
  file) render in the browser and CAN use state, effects, refs, and
  event handlers (`onClick`, `onChange`, etc.). Anything genuinely
  interactive is a Client Component: `header.tsx` (scroll tracking, mobile
  menu), `contact-form.tsx` (form state), everything under `products/`
  (filter state), and every component that uses GSAP (`reveal.tsx`,
  `split-reveal.tsx`, `counter.tsx`, `who-we-are.tsx`, `testimonials.tsx`,
  `logo.tsx`).

**Why does this split exist?** Server Components ship zero JavaScript to the
browser for themselves — faster initial page loads, better for SEO. Client
Components ship the JavaScript needed to make them interactive. The
strategy throughout this codebase is: keep as much as possible as plain
Server Components, and carve out small, focused Client Components only for
the specific pieces that truly need interactivity (see `product-card.tsx`,
which is a Server Component that renders one small Client Component,
`<AddToGiftListButton>`, inside itself — the card's layout/image doesn't
need JavaScript, only its button does).

A Client Component can be **used inside** a Server Component (as
`product-card.tsx` demonstrates), but a Server Component **cannot** be
imported and used inside a Client Component's own module in the same way —
if a file has `"use client"`, everything it directly renders is also
running client-side.

---

## 5. The color system

Colors are defined in **two places that must be kept in sync by hand**:

1. [`src/lib/brand.ts`](src/lib/brand.ts) — a plain TypeScript object
   (`colors`) documenting every hex value in one readable place.
2. [`src/app/globals.css`](src/app/globals.css) — the SAME hex values,
   declared as CSS custom properties (`--color-cream: #fafaf8;` etc.)
   inside a Tailwind v4 `@theme inline { ... }` block.

**Tailwind reads its colors from #2, not #1.** TypeScript can't be read by a
CSS build tool, so the palette has to exist in both files. If you want to
change the site's colors, **you need to edit both `brand.ts` and
`globals.css`** — see the big comment block at the top of `globals.css` for
exactly how the `@theme inline` mechanism turns a CSS variable like
`--color-cream` into Tailwind utility classes like `bg-cream`, `text-cream`,
`border-cream`.

The current palette (see `brand.ts` for the literal hex values and short
descriptions of each):

| Token | Role |
|---|---|
| `cream` | Off-white — the main page background |
| `creamDeep` | Beige — alternates with `cream` between sections for rhythm |
| `charcoal` | Near-black — headings, icons, most text accents |
| `ink` | Dark warm gray — regular paragraph text |
| `white` | A warm "white" (not stark `#FFFFFF`) for card/chip surfaces |
| `red` | The one accent color — used sparingly (small dots, badges, the primary button, a few underlines) |
| `border` | Shared border/divider color |
| `buttonPrimary` / `buttonSecondary` / `buttonTertiary` (+ hover variants) | The three button styles — see `button.tsx` |

---

## 6. Typography

Two Google Fonts are loaded via `next/font/google` in `layout.tsx`:

- **Fraunces** (`font-display` Tailwind class) — the serif-ish display font
  used for headings.
- **Manrope** (`font-sans` Tailwind class) — the body font used for
  everything else (it's also the default, since `<body>` in `layout.tsx`
  has `className="... font-sans ..."`).

`next/font/google` downloads these once at build time and self-hosts them,
rather than the browser fetching them from Google's servers on every visit
— faster, and doesn't leak visitor data to Google.

---

## 7. Animation patterns used throughout

Rather than one-off animation code in every component, a handful of
reusable **patterns** repeat across the codebase:

### `<Reveal>` — fade + rise on scroll
Wrap anything in `<Reveal>...</Reveal>` and it fades in + slides up the
first time it scrolls into view. Implemented with a browser
`IntersectionObserver` (no animation library needed) — see
[`reveal.tsx`](src/components/reveal.tsx). Used for badges, paragraphs,
buttons — anything that doesn't need to be a heading.

### `<SplitReveal>` — word-by-word heading reveal
Splits a heading's text into individual words, each masked so it rises up
"from behind a curtain" into place, staggered slightly per word. Uses GSAP +
ScrollTrigger. See [`split-reveal.tsx`](src/components/split-reveal.tsx) for
the full explanation of the masking trick.

### `<Counter>` — animated number count-up
Renders "0", then animates up to a real number (e.g. "500+") once visible,
using a GSAP tween on a plain JS object (`{ n: 0 }`) whose value gets copied
into the DOM on every frame. See [`counter.tsx`](src/components/counter.tsx).

### Respecting `prefers-reduced-motion`
Every GSAP-based animation in this codebase checks the user's OS-level
"reduce motion" accessibility setting via `gsap.matchMedia()` and skips
straight to the final state for users who have it turned on — see any of
`counter.tsx`, `split-reveal.tsx`, `who-we-are.tsx`, `testimonials.tsx`, or
`logo.tsx` for the same pattern repeated. The CSS-only `<Reveal>` animation
does the equivalent with a plain `@media (prefers-reduced-motion: ...)`
query in `globals.css`.

### Tailwind's "group" hover pattern
Used anywhere a hover effect on one element should be triggered by hovering
its *parent* — e.g. the arrow icon inside a `<Button>` nudging sideways when
the whole button (not just the icon) is hovered. Add `group` to the parent's
className, then `group-hover:...` to the child. Search for `group-hover:` in
`button.tsx`, `header.tsx`, `what-we-offer.tsx`, and `product-card.tsx` to
see it in several different contexts.

### `useGSAP` + `gsap.matchMedia` + `ScrollTrigger`
The recurring shape of every scroll-driven animation in this app:
```tsx
useGSAP(() => {
  const mm = gsap.matchMedia();
  mm.add({ animate: "(prefers-reduced-motion: no-preference)" }, () => {
    gsap.to(someRef.current, {
      /* target values */,
      scrollTrigger: { trigger: someRef.current, start: "top 85%", /* ... */ },
    });
  });
  return () => mm.revert(); // cleanup
}, { scope: someRef });
```
`useGSAP` (from `@gsap/react`) is like `useEffect`, but automatically
cleans up every animation/ScrollTrigger it creates if the component
unmounts. `gsap.matchMedia()` is GSAP's equivalent of a CSS media query for
animation logic — it's what implements the reduced-motion check above.

---

## 8. The `/products` page, in depth

This is the most complex part of the app, worth understanding as a whole:

1. **[`src/lib/products-data.ts`](src/lib/products-data.ts)** defines a
   single nested tree (`spec`) describing every category and product —
   Drinkware → Mugs → Stainless Steel, etc. A recursive function (`walk`)
   converts that one tree into TWO separate things: a `CategoryNode[]` tree
   (for rendering the sidebar filter) and a flat `Product[]` array (for the
   grid), guaranteeing they can never disagree with each other since
   they're derived from the same source.
2. **[`src/app/products/page.tsx`](src/app/products/page.tsx)** (Server
   Component) renders the static banner, then hands off to...
3. **[`products-page-client.tsx`](src/components/products/products-page-client.tsx)**
   (Client Component) — owns ALL the interactive state: which categories
   are checked (`checkedIds`, a `Set<string>`), the price range (split into
   a *pending* value the slider shows live, and an *applied* value that
   actually filters the grid — see the file's comments for why), and
   whether the mobile filter drawer is open. It computes the filtered
   product list with `useMemo` and passes pieces of its state down to:
   - **[`category-filter.tsx`](src/components/products/category-filter.tsx)**
     — a RECURSIVE component (renders itself for each nested category
     level) that displays the tree and reports clicks back up via a
     callback prop, rather than managing its own state.
   - **[`price-filter.tsx`](src/components/products/price-filter.tsx)** —
     the dual-handle slider (two overlapping `<input type="range">`
     elements, styled in `globals.css`).
   - **[`product-card.tsx`](src/components/products/product-card.tsx)** —
     one grid item per filtered product.

This "state lives in one parent, children are given data + callbacks and
report events upward" pattern is called **lifting state up**, and it's the
standard React approach whenever multiple sibling components need to share
or coordinate around the same piece of state.

---

## 9. Common "how do I...?" tasks

**Change a color everywhere on the site**
Edit the hex value in `src/lib/brand.ts` **and** the matching line in
`src/app/globals.css` (search for the same variable name, e.g.
`--color-red`). See section 5 above.

**Add a new nav link**
Add an entry to `siteConfig.navLinks` in `src/lib/brand.ts`. Both the
desktop and mobile nav in `header.tsx`, plus the footer's link column, read
from this one array automatically.

**Add a new homepage section**
Create a new file in `src/components/home_page/`, following the shape of an
existing one (e.g. `who-we-are.tsx`), then import and render it in
`src/app/page.tsx`.

**Add a new product category or product**
Edit the `spec` tree in `src/lib/products-data.ts` — add a new object
(branch, with `children`, or leaf, with `product: { name, base }`) at the
appropriate nesting level. Everything else (the filter sidebar, the grid,
the price bounds) derives from this automatically; no other file needs to
change.

**Add a new icon**
Add a new small function to `src/components/icons.tsx`, following the
existing pattern (spread `{...base} {...props}` onto an `<svg>`, then draw
an SVG `<path>`/`<circle>`/etc. inside it).

**Change button styling**
Edit the `variants` object in `src/components/button.tsx`, or the
`buttonPrimary`/`buttonSecondary`/`buttonTertiary` hex values in
`brand.ts` + `globals.css`.

---

## 10. Running the project

```bash
cd frontend
npm run dev      # start the dev server at http://localhost:3000
npm run build    # production build (also type-checks with TypeScript)
npm run lint     # run ESLint
```

`npm run build` is worth running after any non-trivial change — it runs the
full TypeScript type-checker in addition to bundling, which catches a lot of
mistakes `npm run dev` alone won't surface immediately.

---

## 11. Glossary (quick reference)

- **Component** — a JavaScript/TypeScript function that returns JSX
  (HTML-like syntax) describing what should appear on screen.
- **Props** — the "arguments" passed into a component, e.g.
  `<Button variant="primary">`.
- **State** (`useState`) — data a component "remembers" between renders,
  which can change over time (e.g. whether a menu is open).
- **Effect** (`useEffect`) — code that runs after a component renders,
  typically to synchronize with something outside React (an event
  listener, a timer, a third-party library like GSAP).
- **Ref** (`useRef`) — a way to get a direct handle on a real DOM element
  (or to persist a plain value across renders without triggering a
  re-render when it changes).
- **Memoization** (`useMemo`) — caching the result of a calculation so it's
  only redone when its inputs actually change.
- **JSX** — the `<div>...</div>`-looking syntax used inside `return(...)` —
  it isn't HTML, it's JavaScript that gets compiled into regular function
  calls that build up the UI.
- **Server Component / Client Component** — see section 4 above.
- **Hydration** — the process where React "takes over" server-rendered
  HTML in the browser, attaching event listeners and making it interactive.
- **ScrollTrigger** — a GSAP plugin that ties animation playback to scroll
  position (either "play once when scrolled into view" or continuously
  "scrub" the animation in sync with scroll position).
