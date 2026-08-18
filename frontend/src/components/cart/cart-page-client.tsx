"use client";

// ---------------------------------------------------------------------------
// <CartPageClient> — everything on /cart
// ---------------------------------------------------------------------------
// The cart isn't a checkout — nothing is paid for here. It's the list of
// products a visitor collected with the "Add to Cart" button on the product
// grid (see products/add-to-cart-button.tsx), shown with per-product
// quantities and a running total. The floating "Proceed" button opens
// <CartInquiryModal> (cart-inquiry-modal.tsx), which turns that whole list
// into ONE inquiry for the Handpikd team (POST /product-inquiries/submit —
// see lib/product-inquiries.ts). The contact fields live in that popup
// rather than at the bottom of this page so the page stays a plain review of
// the cart until the visitor actually decides to send.
//
// Cart contents come from the shared <CartProvider> context mounted in
// app/layout.tsx (lib/cart.tsx), which is also what backs the header's cart
// badge — so editing a quantity here updates that badge immediately, and
// vice versa.
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { CheckIcon, MinusIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { CartInquiryModal } from "@/components/cart/cart-inquiry-modal";
import { useCart } from "@/lib/cart";
import { formatInr } from "@/lib/public-products";
import homeStyles from "@/styles/home-page.module.css";
import styles from "@/styles/cart.module.css";

export function CartPageClient() {
  const { items, hydrated, totalItems, totalPrice, setQuantity, removeItem, clearCart } = useCart();
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);

  function handleSent() {
    // Emptying the cart here is safe even though the items list is what this
    // page renders — the `sent` branch below is checked before the "your cart
    // is empty" one, so the thank-you state stays up.
    clearCart();
    setFormOpen(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className={homeStyles.formSuccessWrap}>
        <span className={homeStyles.formSuccessIcon}>
          <CheckIcon className="h-6 w-6" />
        </span>
        <h1 className={homeStyles.formSuccessHeading}>Thanks — we&apos;ll be in touch.</h1>
        <p className={homeStyles.formSuccessText}>
          Your inquiry is with the Handpikd team. Someone will reach out within one business day with pricing and
          availability for the products you selected.
        </p>
        <Link href="/products" className={homeStyles.formSuccessLink}>
          Back to products
        </Link>
      </div>
    );
  }

  // The cart only exists in the browser's localStorage, so on the very first
  // render (server HTML + hydration) it's always empty — showing "Your cart
  // is empty" during that moment would be wrong for anyone who has items.
  if (!hydrated) {
    return (
      <>
        <h1 className={styles.pageHeading}>Your Cart</h1>
        <p className={styles.pageSubtext}>Loading your cart…</p>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <h1 className={styles.pageHeading}>Your Cart</h1>
        <div className={styles.emptyWrap}>
          <p className={styles.emptyHeading}>Your cart is empty</p>
          <p className={styles.emptyText}>
            Add the products you&apos;re interested in and send us one inquiry for all of them together.
          </p>
          <Button href="/products" variant="primary" showArrow>
            Browse products
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.pageHeading}>Your Cart</h1>
      <p className={styles.pageSubtext}>
        {totalItems} {totalItems === 1 ? "item" : "items"} — review the quantities, then hit Proceed to send your
        inquiry.
      </p>

      <div className={styles.itemList}>
        {items.map((item) => (
          <div key={item.id} className={styles.item}>
            {/* Plain <img>, not next/image — product images are
                admin-controlled arbitrary URLs, same reasoning as
                products/product-card.tsx (see its comment for the details). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset */}
            <img src={item.image} alt={item.name} loading="lazy" className={styles.itemImage} />

            <div className={styles.itemMain}>
              <div>
                <p className={styles.itemName}>{item.name}</p>
                <p className={styles.itemUnitPrice}>{formatInr(item.price)} each</p>
              </div>

              <div className={styles.itemControls}>
                <div className={styles.stepper}>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.id, item.quantity - 1)}
                    aria-label={item.quantity === 1 ? `Remove ${item.name}` : `Decrease quantity of ${item.name}`}
                    className={styles.stepperButton}
                  >
                    <MinusIcon className="h-4 w-4" />
                  </button>
                  <span aria-live="polite" className={styles.stepperValue}>
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.id, item.quantity + 1)}
                    aria-label={`Increase quantity of ${item.name}`}
                    className={styles.stepperButton}
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                </div>

                <p className={styles.itemLineTotal}>{formatInr(item.price * item.quantity)}</p>

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.name} from cart`}
                  className={styles.removeButton}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Items</span>
          <span>{totalItems}</span>
        </div>
        <div className={`${styles.summaryRow} ${styles.summaryTotalRow}`}>
          <span>Total</span>
          <span className={styles.summaryTotalValue}>{formatInr(totalPrice)}</span>
        </div>
        {/* Prices on the storefront are the listed per-unit prices, which
            don't include GST or delivery — saying so here avoids the total
            reading as a final quote. */}
        <p className={styles.summaryNote}>Indicative total, excluding GST and delivery.</p>
      </div>

      <div className={styles.clearCartRow}>
        <button type="button" onClick={clearCart} className={styles.clearCartButton}>
          Clear cart
        </button>
      </div>

      {/* Floating CTA rather than an inline button so it stays reachable
          while scrolling a long cart. It replaces the site-wide
          <FloatingInquiryButton>, which hides itself on /cart. */}
      <button type="button" onClick={() => setFormOpen(true)} className={styles.proceedButton}>
        Proceed
        <span className={styles.proceedTotal}>{formatInr(totalPrice)}</span>
      </button>

      {formOpen && (
        <CartInquiryModal
          items={items}
          totalItems={totalItems}
          onClose={() => setFormOpen(false)}
          onSuccess={handleSent}
        />
      )}
    </>
  );
}
