// ---------------------------------------------------------------------------
// <ComingSoon> — shared placeholder page for routes with no real content yet
// ---------------------------------------------------------------------------
// Reused by both src/app/blogs/page.tsx and src/app/catalogue-style
// "not built yet" routes. Rather than each empty route duplicating its own
// Header/Footer/"coming soon" markup, they all render THIS one component
// and just pass a different `title`. If a real Blog page gets built later,
// its page.tsx file would stop rendering <ComingSoon> and render real
// content instead — this component would just become unused for that route.
//
// Styling lives in src/styles/shared.module.css.
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/button";
import { Eyebrow } from "@/components/eyebrow";
import styles from "@/styles/shared.module.css";

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      {/* Every real page includes its own <Header>/<Footer> (they're not
          part of the root layout) — see src/app/page.tsx and
          src/app/products/page.tsx for the same pattern. */}
      <Header />
      <main className={styles.comingSoonMain}>
        <Eyebrow>Coming Soon</Eyebrow>
        <h1 className={styles.comingSoonHeading}>{title}</h1>
        <p className={styles.comingSoonBlurb}>
          This page is on its way. In the meantime, head back home or reach
          out through our contact form.
        </p>
        <div className={styles.comingSoonActions}>
          <Button href="/" variant="primary">
            Back to Home
          </Button>
          <Button href="/#connect" variant="tertiary">
            Contact Us
          </Button>
        </div>
      </main>
      <Footer />
    </>
  );
}
