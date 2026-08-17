"use client";

// ---------------------------------------------------------------------------
// <AddToCartButton> — the CTA on every product card
// ---------------------------------------------------------------------------
// Replaces the old "Get It Now" button (which opened a one-product enquiry
// popup — get-it-now-button.tsx/get-it-now-modal.tsx are still in the repo,
// unused here, for reuse on other pages later). Instead of enquiring about a
// single product on the spot, a visitor now collects several products and
// sends ONE inquiry from /cart.
//
// Two states in the same slot, so the card's height never changes:
//   - not in the cart yet -> a full-width "Add to Cart" button
//   - already in the cart -> a −/quantity/+ stepper, where stepping the
//     quantity down past 1 removes the product again
// Kept as its own small Client Component (like <GetItNowButton> was) so
// product-card.tsx and the grid around it stay Server Components.
import { MinusIcon, PlusIcon, ShoppingCartIcon } from "@/components/icons";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/public-products";
import styles from "@/styles/products.module.css";

export function AddToCartButton({ product }: { product: Product }) {
  const { quantityOf, addItem, setQuantity, hydrated } = useCart();
  const quantity = quantityOf(product.id);

  // Until the cart has been read back out of localStorage (see lib/cart.tsx),
  // every product looks like it isn't in the cart. Rendering the plain
  // "Add to Cart" button during that first moment is the honest default —
  // it matches the server-rendered HTML, and flips to the stepper as soon as
  // the real cart lands a tick later.
  if (!hydrated || quantity === 0) {
    return (
      <button
        type="button"
        onClick={() =>
          addItem({ id: product.id, name: product.name, price: product.price, image: product.image })
        }
        className={styles.addToCartButton}
      >
        <ShoppingCartIcon className="h-4 w-4" />
        Add to Cart
      </button>
    );
  }

  return (
    <div className={styles.quantityStepper}>
      <button
        type="button"
        onClick={() => setQuantity(product.id, quantity - 1)}
        // At a quantity of 1 the next "−" press removes the product
        // entirely, so the label says so rather than claiming to decrease.
        aria-label={quantity === 1 ? `Remove ${product.name} from cart` : `Decrease quantity of ${product.name}`}
        className={styles.quantityStepperButton}
      >
        <MinusIcon className="h-4 w-4" />
      </button>
      <span aria-live="polite" className={styles.quantityStepperValue}>
        {quantity}
      </span>
      <button
        type="button"
        onClick={() => setQuantity(product.id, quantity + 1)}
        aria-label={`Increase quantity of ${product.name}`}
        className={styles.quantityStepperButton}
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
