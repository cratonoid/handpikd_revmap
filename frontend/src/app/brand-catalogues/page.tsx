// Route: "/brand-catalogues" (this file sits in an `app/brand-catalogues/`
// folder).
//
// A Server Component: the banner below is static text, so it's rendered here
// directly. The tabbed, data-fetching part — sections, category subheaders,
// catalogue cards, and the page-viewer lightbox — lives in the separate
// Client Component <BrandCataloguesPageClient>, backed by real
// admin-managed catalogues (see backend/app/api/routes/catalogues.py's
// get_public_catalogues) rather than the static gallery on /catalogue.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { BrandCataloguesPageClient } from "@/components/brand-catalogues/brand-catalogues-page-client";
import styles from "@/styles/brand-catalogues.module.css";
import sharedStyles from "@/styles/shared.module.css";

export const metadata: Metadata = {
  title: "Brand Catalogues",
  description:
    "Browse Handpikd's brand and category-wise vendor catalogues, organized by section and category.",
};

export default function BrandCataloguesPage() {
  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        <section className={styles.banner}>
          <div className={styles.bannerInner}>
            <h1 className={styles.bannerHeading}>Brand & Category Catalogues</h1>
            <p className={styles.bannerParagraph}>
              Explore vendor catalogues organized by brand and by category — browse each one page
              by page.
            </p>
          </div>
        </section>

        <BrandCataloguesPageClient />
      </main>
      <Footer />
    </>
  );
}
