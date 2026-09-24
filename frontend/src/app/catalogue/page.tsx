// Route: "/catalogue" (this file sits in an `app/catalogue/` folder).
//
// A Server Component whose only job is the page shell — the tabbed,
// data-fetching part (sections, category subheaders, catalogue cards, and the
// page-viewer lightbox) lives in the separate Client Component
// <CataloguePageClient>, backed by real admin-managed catalogues (see
// backend/app/api/routes/catalogues.py's get_public_catalogues).
//
// This page used to be a static gallery whose photos were committed under
// public/catalogs, with the admin-managed version living separately at
// /brand-catalogues. Both are now one page on this URL, and
// /brand-catalogues 308-redirects here (see next.config.ts).
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/button";
import { CataloguePageClient } from "@/components/catalogue/catalogue-page-client";
import styles from "@/styles/catalogue.module.css";
import sharedStyles from "@/styles/shared.module.css";

export const metadata: Metadata = {
  title: "Corporate Gift Catalogue",
  description:
    "Browse Handpikd's corporate gift catalogue — combo boxes, premium trophies, custom bottles, diaries, keychains, mugs, and pens, organized by category with full photo galleries.",
};

export default function CataloguePage() {
  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        {/* No visible banner here on purpose — the page goes straight from
            the header into the section tabs, the same way /products goes
            straight into its filters. `sr-only` keeps a real <h1> in the
            document (hidden visually, but read by screen readers and search
            engines) so the page still has a proper heading for
            accessibility/SEO even without a visible title band. */}
        <h1 className="sr-only">Corporate Gift Catalogue</h1>

        <CataloguePageClient />

        <div className={styles.ctaWrap}>
          <div className={styles.ctaSection}>
            <h2 className={styles.ctaHeading}>Need Help Choosing Corporate Gifts?</h2>
            <p className={styles.ctaParagraph}>
              Our corporate gifting experts are here to help you find the perfect business
              gifts for your clients, employees, and business events.
            </p>
            <div className={styles.ctaButtonRow}>
              <Button href="/#connect" variant="primary">
                Get in Touch
              </Button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
