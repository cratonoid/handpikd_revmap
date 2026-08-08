// ---------------------------------------------------------------------------
// <ProductCard> — one item in the product grid
// ---------------------------------------------------------------------------
// A plain Server Component (no interactivity of its own) — the only
// interactive piece, the "Get It Now" button (which opens a popup enquiry
// form), is broken out into its own small Client Component (see
// get-it-now-button.tsx) so this file and the grid around it don't need
// "use client" just because of one button.
//
// Styling lives in src/styles/products.module.css.
import { formatInr, type Product } from "@/lib/public-products";
import { GetItNowButton } from "@/components/products/get-it-now-button";
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
        {/* Plain <img>, not next/image: product images are admin-controlled
            arbitrary URLs (own /media uploads OR any externally pasted URL —
            see product-form-modal.tsx's identical choice/comment for the
            admin thumbnail preview), so there's no fixed remote-host
            whitelist that could cover them all. next/image throws an
            uncaught, page-crashing error for any host not listed in
            next.config.js's images.remotePatterns. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset */}
        <img src={product.image} alt={product.alt} loading="lazy" className={styles.cardImage} />
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
        <GetItNowButton productName={product.name} />
      </div>
    </article>
  );
}
