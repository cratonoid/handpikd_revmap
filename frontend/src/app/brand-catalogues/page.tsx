// Route: "/brand-catalogues" (this file sits in an `app/brand-catalogues/`
// folder).
//
// A Server Component whose only job is the page shell — the tabbed,
// data-fetching part (sections, category subheaders, catalogue cards, and the
// page-viewer lightbox) lives in the separate Client Component
// <BrandCataloguesPageClient>, backed by real admin-managed catalogues (see
// backend/app/api/routes/catalogues.py's get_public_catalogues) rather than
// the static gallery on /catalogue.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { BrandCataloguesPageClient } from "@/components/brand-catalogues/brand-catalogues-page-client";
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
        {/* No visible banner here on purpose — the page goes straight from
            the header into the section tabs, the same way /products goes
            straight into its filters. `sr-only` keeps a real <h1> in the
            document (hidden visually, but read by screen readers and search
            engines) so the page still has a proper heading for
            accessibility/SEO even without a visible title band. */}
        <h1 className="sr-only">Brand &amp; Category Catalogues</h1>

        <BrandCataloguesPageClient />
      </main>
      <Footer />
    </>
  );
}
