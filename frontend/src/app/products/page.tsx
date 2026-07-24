// Route: "/products" (this file sits in an `app/products/` folder).
//
// This is a Server Component (no "use client") that renders the static
// page header/banner, then hands off to <ProductsPageClient> — a separate
// Client Component — for everything interactive (filters, the product
// grid). Splitting it this way means the page's shell (title, metadata,
// banner text) can be server-rendered for speed/SEO, while only the
// genuinely interactive part ships extra JavaScript to the browser.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Eyebrow } from "@/components/eyebrow";
import { ProductsPageClient } from "@/components/products/products-page-client";

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
      <main className="flex-1">
        {/* The beige banner strip above the filters/grid — just the page
            title and a one-line description, no interactivity. */}
        <div className="border-b border-charcoal/10 bg-cream-deep px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-[1680px]">
            <Eyebrow>Shop</Eyebrow>
            <h1 className="mt-1.5 font-display text-2xl font-semibold text-charcoal sm:text-3xl">
              Corporate Gifting Catalogue
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-ink">
              Filter by category and price to find the right gift for every
              recipient, occasion, and budget.
            </p>
          </div>
        </div>

        {/* Everything below the banner — the filter sidebar, the price
            slider, and the product grid — lives in this one Client
            Component. See products-page-client.tsx for the full logic. */}
        <ProductsPageClient />
      </main>
      <Footer />
    </>
  );
}
