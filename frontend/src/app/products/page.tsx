import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Eyebrow } from "@/components/eyebrow";
import { ProductsPageClient } from "@/components/products/products-page-client";

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
        <div className="border-b border-charcoal/10 bg-cream-deep px-5 py-10 sm:px-8">
          <div className="mx-auto max-w-[1600px]">
            <Eyebrow>Shop</Eyebrow>
            <h1 className="mt-2 font-display text-3xl font-semibold text-charcoal sm:text-4xl">
              Corporate Gifting Catalogue
            </h1>
            <p className="mt-2 max-w-xl text-ink">
              Filter by category and price to find the right gift for every
              recipient, occasion, and budget.
            </p>
          </div>
        </div>
        <ProductsPageClient />
      </main>
      <Footer />
    </>
  );
}
