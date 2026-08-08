// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------
// In Next.js's App Router, a file named `layout.tsx` wraps every page inside
// its folder (and this one, at src/app/layout.tsx, is the TOP-level layout —
// it wraps literally every page on the whole site: "/", "/products",
// "/blogs", etc.). This is where things that should be identical on every
// page live: the <html>/<body> tags themselves, global fonts, the default
// page <title>/description, and structured data for search engines.
//
// Unlike most files in this project, this one has NO "use client" directive,
// which means it's a Server Component — it runs on the server (or at build
// time) and sends plain HTML to the browser. That's normal/default for
// Next.js App Router files; only files that need interactivity (state,
// event handlers, effects) opt into becoming Client Components.

import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
// Importing the global stylesheet here (once) is what makes it apply to the
// entire app — see src/app/globals.css for what's actually in it.
import "./globals.css";

// `next/font/google` downloads and self-hosts Google Fonts at BUILD time
// (rather than the browser fetching them from Google's servers at runtime),
// which is faster and more private. Calling `Fraunces({...})` returns an
// object with a `.variable` property — a CSS class name that, once applied
// to an element (see the <html> tag below), defines a CSS variable
// (`--font-fraunces`) holding the actual font-family. globals.css then maps
// that variable to the friendlier `font-display` Tailwind class.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"], // only load the Latin character set, not every language, to keep the download small
  axes: ["opsz"], // "optical size" — lets this variable font adjust its shape slightly at different sizes
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

// Shared between the <title>/<meta description> tags below AND the
// JSON-LD structured data further down, so the wording only has to be
// written once.
const title = "Corporate Gifting in Bangalore | Premium Business Gifts | Handpikd";
const description =
  "Leading corporate gifting company in Bangalore. Premium corporate gifts, custom gift hampers, and branded merchandise for businesses — sourced and shipped nationwide.";

// Exporting a constant named exactly `metadata` from a layout or page file
// is special Next.js App Router convention — Next.js automatically reads it
// and generates the corresponding <title>, <meta>, and Open Graph/Twitter
// card tags in the page <head>, without you having to write any <head> JSX
// by hand.
export const metadata: Metadata = {
  title: {
    default: title,
    // Individual pages can export their OWN `metadata.title` (see
    // src/app/products/page.tsx, which sets it to "Shop Corporate Gifts").
    // This `template` says: whenever a page sets its own title, wrap it as
    // "<page title> | Handpikd" instead of just replacing it outright.
    template: "%s | Handpikd",
  },
  description,
  keywords: [
    "corporate gifting bangalore",
    "corporate gifts bangalore",
    "corporate gifting in bangalore",
    "corporate gift company bangalore",
    "corporate gifting",
    "corporate gifts",
    "business gifts india",
    "custom corporate gifting",
    "luxury gift hampers",
    "branded merchandise",
    "employee recognition gifts",
  ],
  // Open Graph tags control how the page looks when shared/linked on social
  // platforms (Facebook, LinkedIn, iMessage previews, etc.).
  openGraph: {
    title,
    description,
    siteName: "Handpikd",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

// JSON-LD ("JSON for Linking Data") is a small script of structured data
// that helps search engines understand facts about the business (its name,
// address, social profiles) beyond what they can guess from visible page
// text. It has no visual effect on the page at all — it's purely for SEO.
// The `@context`/`@type` keys are part of the schema.org standard vocabulary
// that Google and other search engines know how to parse.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Handpikd",
  description,
  email: "info@handpikd.co",
  address: {
    "@type": "PostalAddress",
    streetAddress: "2nd Cross Rd, SGN Layout, Vinobha Nagar, Sudhama Nagar",
    addressLocality: "Bengaluru",
    addressRegion: "Karnataka",
    postalCode: "560027",
    addressCountry: "IN",
  },
  // No real LinkedIn/Instagram profiles yet — WhatsApp (same number as the
  // footer's contact link) is the one real, verifiable "elsewhere on the
  // web" presence to list here.
  sameAs: ["https://wa.me/917411690399"],
};

// Every layout/page component in the App Router receives a `children` prop
// — it's however Next.js decides to fill in "everything below this level."
// For this root layout, `children` will be whatever page.tsx (or nested
// layout) matches the current URL. `Readonly<{...}>` is just a TypeScript
// wrapper that marks the props object's fields as read-only.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Every page's HTML starts here — this <html> tag is the outermost
    // element of the ENTIRE site, so global attributes go here:
    //   - `lang="en"` for accessibility/screen readers and SEO.
    //   - the two font `.variable` classes, so `--font-fraunces` and
    //     `--font-manrope` are available to every element on the page.
    //   - `scroll-pt-24` reserves 6rem of top padding when scrolling to an
    //     anchor link (like "/#connect"), so content doesn't end up hidden
    //     underneath the sticky header.
    //   - `motion-safe:scroll-smooth` turns on smooth (animated) scrolling
    //     for anchor links, but ONLY for users who haven't requested
    //     reduced motion (Tailwind's `motion-safe:` prefix is shorthand for
    //     a `prefers-reduced-motion: no-preference` media query).
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} h-full scroll-pt-24 motion-safe:scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream font-sans text-ink">
        {/* <noscript> only renders for users with JavaScript disabled.
            The scroll-in animation on `.reveal` elements (see
            src/components/reveal.tsx) starts them at opacity: 0 and relies
            on JavaScript to reveal them — if JS never runs, that content
            would stay invisible forever. This inline <style> forces every
            ".reveal" element back to fully visible for those users, as a
            safety net. (Headings used to have a similar word-by-word
            reveal via a SplitReveal component, but that relied ENTIRELY on
            JavaScript with no equivalent CSS-only fallback for this
            noscript case — not just when JS was disabled, but any time the
            reveal script failed to run for any other reason — which could
            leave a heading permanently blank. It's been removed in favor
            of always-visible static headings.) */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
        </noscript>

        {/* Renders the JSON-LD object above as a literal <script> tag in the
            page's HTML. `dangerouslySetInnerHTML` is React's escape hatch
            for injecting a raw HTML string instead of normal JSX children —
            it's named "dangerous" because doing this with untrusted/user-
            supplied text can enable XSS attacks. It's safe here because
            `organizationJsonLd` is a hardcoded object defined above, not
            anything a user typed in. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />

        {/* Wherever this layout is used, `children` is the actual page
            content — e.g. everything rendered by src/app/page.tsx when
            you're on "/". */}
        {children}
      </body>
    </html>
  );
}
