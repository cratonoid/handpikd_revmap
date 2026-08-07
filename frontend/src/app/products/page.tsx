// Route: "/products" (this file sits in an `app/products/` folder).
//
// This is a Server Component (no "use client") that renders the shared
// Header/Footer, then hands off to <ProductsPageClient> — a separate
// Client Component — for everything else (filters, the product grid).
// Splitting it this way means the page's shell can be server-rendered for
// speed/SEO, while only the genuinely interactive part ships extra
// JavaScript to the browser.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ProductsPageClient } from "@/components/products/products-page-client";
import styles from "@/styles/shared.module.css";

// Page-specific metadata. Because layout.tsx's `metadata.title.template` is
// `"%s | Handpikd"`, this "Shop Corporate Gifts" title actually renders as
// "Shop Corporate Gifts | Handpikd" in the browser tab.
export const metadata: Metadata = {
  title: "Shop Corporate Gifts",
  description:
    "Browse Handpikd's corporate gifting catalogue — drinkware, tech accessories, stationery, and bags, filterable by category and price.",
};

export default function ProductsPage() {
  return (
    <>
      <Header />
      <main className={styles.pageMain}>
        {/* No visible banner here on purpose — the page goes straight from
            the header into the filters/grid. `sr-only` keeps a real <h1>
            in the document (hidden visually, but read by screen readers
            and search engines) so the page still has a proper heading for
            accessibility/SEO even without a visible title band. */}
        <h1 className="sr-only">Corporate Gifting Catalogue</h1>

        {/* Everything visible on this page — the filter sidebar, the price
            slider, and the product grid — lives in this one Client
            Component. See products-page-client.tsx for the full logic. */}
        <ProductsPageClient />
      </main>
      <Footer />
    </>
  );
}
