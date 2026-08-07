// Route: "/catalogue" (this file sits in an `app/catalogue/` folder).
//
// A Server Component: the banner and CTA band below are static text, so
// they're rendered here directly. Only the actual grid + lightbox gallery
// (which needs click state) lives in the separate Client Component
// <CataloguePageClient> — see that file for the interactive half.
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
        <section className={styles.banner}>
          <div className={styles.bannerInner}>
            <h1 className={styles.bannerHeading}>
              Corporate Gift Catalogue — Premium Business Gifts
            </h1>
            <p className={styles.bannerParagraph}>
              Explore our full range of premium corporate gifts, branded merchandise, and
              custom business gifting solutions for every occasion — serving Bangalore and
              across India.
            </p>
          </div>
        </section>

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
