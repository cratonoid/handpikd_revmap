"use client";

// ---------------------------------------------------------------------------
// <AddToCartButton> — adds this product to the cart (lib/cart.ts)
// ---------------------------------------------------------------------------
// Sits alongside <GetItNowButton> on every product card. Unlike Get It Now
// (which immediately opens a single-product enquiry form), this just pushes
// the product into the shared cart and shows a brief "Added" confirmation —
// the actual enquiry only gets sent once the shopper opens the cart (via the
// header's cart icon) and submits it there, potentially with several
// products at once. See components/cart/cart-modal.tsx for that flow.
import { useState } from "react";
import { addToCart } from "@/lib/cart";
import { CheckIcon } from "@/components/icons";
import styles from "@/styles/products.module.css";

export function AddToCartButton({
  productId,
  name,
  price,
  originalPrice,
  image,
}: {
  productId: string;
  name: string;
  price: number;
  originalPrice: number;
  image: string;
}) {
  const [added, setAdded] = useState(false);

  function handleClick() {
    addToCart({ productId, name, price, originalPrice, image });
    setAdded(true);
    // Reverts the confirmation state after a moment so the button is ready
    // to show "Added" again if the shopper adds more of the same product.
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button type="button" onClick={handleClick} className={styles.addToCartButton}>
      {added ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          Added
        </>
      ) : (
        "Add to Cart"
      )}
    </button>
  );
}