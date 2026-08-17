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
//     quantity down past 1 removes the product again. The quantity in the
//     middle is also a plain typeable number input (not just +/- taps), for
//     jumping straight to a larger quantity.
// Kept as its own small Client Component (like <GetItNowButton> was) so
// product-card.tsx and the grid around it stay Server Components.
import { useState } from "react";
import { MinusIcon, PlusIcon, ShoppingCartIcon } from "@/components/icons";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/public-products";
import styles from "@/styles/products.module.css";

export function AddToCartButton({ product }: { product: Product }) {
  const { quantityOf, addItem, setQuantity, hydrated } = useCart();
  const quantity = quantityOf(product.id);

  // A separate "draft" string (rather than binding the input straight to
  // `quantity`) so the field can hold in-progress typing — like a
  // momentarily empty box while backspacing — without every keystroke
  // needing to already be a valid quantity. `lastSyncedQuantity` + the
  // render-time check below re-sync `draft` whenever the real quantity
  // changes from elsewhere (the +/- buttons, or another card/tab touching
  // the same cart) — adjusting state during render like this, rather than in
  // a useEffect, avoids an extra commit-then-immediately-re-render pass (see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [draft, setDraft] = useState(String(quantity));
  const [lastSyncedQuantity, setLastSyncedQuantity] = useState(quantity);
  if (quantity !== lastSyncedQuantity) {
    setLastSyncedQuantity(quantity);
    setDraft(String(quantity));
  }

  // Commits whatever's currently typed once the field is left (blur) or
  // Enter is pressed. An empty/invalid entry just snaps back to the last
  // real quantity instead of silently doing nothing.
  function commitDraft() {
    const parsed = Math.floor(Number(draft));
    if (draft.trim() !== "" && Number.isFinite(parsed)) {
      setQuantity(product.id, Math.max(0, parsed));
    } else {
      setDraft(String(quantity));
    }
  }

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
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        aria-label={`Quantity of ${product.name}`}
        className={styles.quantityStepperValue}
      />
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
