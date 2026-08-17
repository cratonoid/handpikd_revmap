"use client";

// ---------------------------------------------------------------------------
// <FloatingInquiryButton> — site-wide floating CTA back to /cart
// ---------------------------------------------------------------------------
// Mounted once in app/layout.tsx (inside <CartProvider>, alongside every
// page's `children`) so it can float over any storefront page a visitor
// browses on after adding something to their cart — not just /products —
// the same reasoning as the header's cart badge (see lib/cart.tsx).
//
// Hidden in three cases:
//   - before the cart has hydrated, or once hydrated with nothing in it —
//     there'd be no inquiry to send yet.
//   - on /cart itself — that's already the destination this button leads to.
//   - on /admin/** and /customer/** — those are the dashboard shells
//     (see app/admin/layout.tsx, app/customer/layout.tsx), not the storefront
//     this cart belongs to.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCartIcon } from "@/components/icons";
import { useCart } from "@/lib/cart";
import styles from "@/styles/shared.module.css";

export function FloatingInquiryButton() {
  const { hydrated, totalItems } = useCart();
  const pathname = usePathname();

  const onDashboard = pathname.startsWith("/admin") || pathname.startsWith("/customer");
  if (!hydrated || totalItems === 0 || pathname === "/cart" || onDashboard) {
    return null;
  }

  return (
    <Link href="/cart" className={styles.floatingInquiryButton} aria-label={`Send inquiry for ${totalItems} items`}>
      <ShoppingCartIcon className="h-5 w-5" />
      Send Inquiry
      <span className={styles.floatingInquiryBadge}>{totalItems}</span>
    </Link>
  );
}
