// Route: "/cart" (this file sits in an `app/cart/` folder).
//
// A Server Component wrapper that renders the shared Header/Footer, then
// hands off to <CartPageClient> — the cart's contents live in browser
// localStorage (see lib/cart.tsx), so everything below the shell has to be
// a Client Component.
import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CartPageClient } from "@/components/cart/cart-page-client";
import styles from "@/styles/cart.module.css";
import sharedStyles from "@/styles/shared.module.css";

export const metadata: Metadata = {
  title: "Your Cart",
  description: "Review the products you've added and send Handpikd one inquiry for all of them.",
  // A per-visitor page with nothing stable to index — kept out of search
  // results the same way /admin and /login are (see src/app/robots.ts), and
  // deliberately absent from src/app/sitemap.ts.
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return (
    <>
      <Header />
      <main className={sharedStyles.pageMain}>
        <div className={styles.pageInner}>
          <CartPageClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
