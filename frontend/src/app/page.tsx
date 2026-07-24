// ---------------------------------------------------------------------------
// Homepage ("/")
// ---------------------------------------------------------------------------
// In the App Router, a file literally named `page.tsx` is what makes a route
// exist. This file lives directly in `src/app/`, so it becomes the page
// shown at the site root, "/". (Compare to src/app/products/page.tsx, which
// — because it's inside a `products` folder — becomes "/products".)
//
// This file itself does very little: it just imports every homepage section
// as its own component and lists them in order. All the actual content,
// styling, and animation logic lives inside each section component. Keeping
// this file simple makes the page's overall structure easy to scan at a
// glance, and makes it trivial to reorder, add, or remove a whole section.
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { WhoWeAre } from "@/components/sections/who-we-are";
import { ClientMarquee } from "@/components/sections/client-marquee";
import { WhatWeOffer } from "@/components/sections/what-we-offer";
import { Testimonials } from "@/components/sections/testimonials";
import { Connect } from "@/components/sections/connect";

export default function Home() {
  return (
    // A React component can only `return` ONE root element. `<>...</>` is a
    // "Fragment" — shorthand for `<React.Fragment>` — which groups multiple
    // siblings (Header, main, Footer) together WITHOUT adding an extra
    // wrapping <div> to the actual HTML output.
    <>
      <Header />
      {/* `flex-1` makes <main> stretch to fill any leftover vertical space
          between the header and footer, so the footer stays pinned to the
          bottom of the viewport on short pages instead of floating
          partway up the screen. (This only works because <body> in
          layout.tsx is `display: flex; flex-direction: column`.) */}
      <main className="flex-1">
        <Hero />
        <WhoWeAre />
        <ClientMarquee />
        <WhatWeOffer />
        <Testimonials />
        <Connect />
      </main>
      <Footer />
    </>
  );
}
