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
import { Hero } from "@/components/home_page/hero";
import { WhoWeAre } from "@/components/home_page/who-we-are";
import { ClientMarquee } from "@/components/home_page/client-marquee";
import { WhatWeOffer } from "@/components/home_page/what-we-offer";
import { Testimonials } from "@/components/home_page/testimonials";
import { Connect } from "@/components/home_page/connect";
import styles from "@/styles/shared.module.css";

export default function Home() {
  return (
    // A React component can only `return` ONE root element. `<>...</>` is a
    // "Fragment" — shorthand for `<React.Fragment>` — which groups multiple
    // siblings (Header, main, Footer) together WITHOUT adding an extra
    // wrapping <div> to the actual HTML output.
    <>
      <Header />
      {/* `.pageMain` (flex: 1 1 0%) makes <main> stretch to fill any
          leftover vertical space between the header and footer, so the
          footer stays pinned to the bottom of the viewport on short pages
          instead of floating partway up the screen. (This only works
          because <body> in layout.tsx is `display: flex; flex-direction:
          column`.) */}
      <main className={styles.pageMain}>
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
