// ---------------------------------------------------------------------------
// <ProductCard> — one item in the product grid
// ---------------------------------------------------------------------------
// A plain Server Component (no interactivity of its own) — the only
// interactive piece, the "Add to Gift List" button, is broken out into its
// own small Client Component (see add-to-gift-list-button.tsx) so this file
// and the grid around it don't need "use client" just because of one button.
//
// Styling lives in src/styles/products.module.css.
import Image from "next/image";
import { formatInr, type Product } from "@/lib/products-data";
import { AddToGiftListButton } from "@/components/products/add-to-gift-list-button";
import styles from "@/styles/products.module.css";

export function ProductCard({ product }: { product: Product }) {
  // Works out what percentage discount `originalPrice` represents compared
  // to the current `price`, e.g. price=1409, originalPrice=1799 -> about
  // 22% off. `Math.round` avoids showing an ugly decimal like "21.7%".
  const discountPct = Math.round(100 - (product.price / product.originalPrice) * 100);

  return (
    // `.cardArticle` (paired with `.cardArticle:hover .cardImageWrap` /
    // `.cardArticle:hover .cardImage` in the CSS) lets hovering anywhere on
    // the card affect the image's shadow/zoom — the CSS Module equivalent
    // of Tailwind's "group" pattern used elsewhere in the app.
    <article className={styles.cardArticle}>
      <div className={styles.cardImageWrap}>
        <Image
          src={product.image}
          alt={product.alt}
          fill
          // Tells Next.js roughly how wide this image will actually render
          // at different screen sizes (it changes because the grid has a
          // different number of columns at different breakpoints — see
          // products-page-client.tsx), so it can serve an appropriately
          // sized file instead of always the largest one.
          sizes="(min-width: 1280px) 22vw, (min-width: 1024px) 28vw, (min-width: 640px) 45vw, 90vw"
          className={styles.cardImage}
        />
        {/* Only render the discount badge if there actually IS a
            discount — `discountPct > 0 && (...)` renders nothing at all
            when the condition is false. */}
        {discountPct > 0 && <span className={styles.cardBadge}>-{discountPct}%</span>}
      </div>

      <div className={styles.cardBody}>
        {/* `.cardTitle` truncates the product name to at most 2 lines
            (adding "…" if it's longer) and reserves space for 2 lines even
            for SHORT names — together these keep every card in the grid
            the same height regardless of how long each product's name is. */}
        <h3 className={styles.cardTitle}>{product.name}</h3>
        {/* `margin-top: auto` (`.cardPriceRow`) pushes this price row down
            to the bottom of the card (since the parent is a flex column
            with `flex: 1` on this whole div) — this is what keeps every
            card's price aligned along the same baseline even when product
            names wrap to different numbers of lines above them. */}
        <div className={styles.cardPriceRow}>
          <span className={styles.cardPrice}>{formatInr(product.price)}</span>
          {/* The strikethrough "original price," only shown when it's
              actually higher than the current price. */}
          {product.originalPrice > product.price && (
            <span className={styles.cardOriginalPrice}>{formatInr(product.originalPrice)}</span>
          )}
        </div>
        <AddToGiftListButton productName={product.name} />
      </div>
    </article>
  );
}
