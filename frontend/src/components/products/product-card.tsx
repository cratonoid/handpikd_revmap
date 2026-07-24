// ---------------------------------------------------------------------------
// <ProductCard> — one item in the product grid
// ---------------------------------------------------------------------------
// A plain Server Component (no interactivity of its own) — the only
// interactive piece, the "Add to Gift List" button, is broken out into its
// own small Client Component (see add-to-gift-list-button.tsx) so this file
// and the grid around it don't need "use client" just because of one button.
import Image from "next/image";
import { formatInr, type Product } from "@/lib/products-data";
import { AddToGiftListButton } from "@/components/products/add-to-gift-list-button";

export function ProductCard({ product }: { product: Product }) {
  // Works out what percentage discount `originalPrice` represents compared
  // to the current `price`, e.g. price=1409, originalPrice=1799 -> about
  // 22% off. `Math.round` avoids showing an ugly decimal like "21.7%".
  const discountPct = Math.round(100 - (product.price / product.originalPrice) * 100);

  return (
    // `group` here (paired with `group-hover:` below) lets hovering
    // anywhere on the card affect the image's shadow/zoom — same Tailwind
    // pattern used in what-we-offer.tsx and button.tsx.
    <article className="group flex h-full flex-col">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-cream-deep shadow-md shadow-charcoal/0 transition-shadow duration-300 group-hover:shadow-charcoal/15">
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
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {/* Only render the discount badge if there actually IS a
            discount — `discountPct > 0 && (...)` renders nothing at all
            when the condition is false. */}
        {discountPct > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-red px-2.5 py-1 text-xs font-semibold text-cream">
            -{discountPct}%
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-1 flex-col">
        {/* `line-clamp-2` truncates the product name to at most 2 lines
            (adding "…" if it's longer), and `min-h-[2.5rem]` reserves
            space for 2 lines even for SHORT names — together these keep
            every card in the grid the same height regardless of how long
            each product's name is. */}
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm leading-tight font-medium text-charcoal">
          {product.name}
        </h3>
        {/* `mt-auto` pushes this price row down to the bottom of the card
            (since the parent is a flex column with `flex-1` on this whole
            div) — this is what keeps every card's price aligned along the
            same baseline even when product names wrap to different
            numbers of lines above them. */}
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-sm font-semibold text-charcoal">{formatInr(product.price)}</span>
          {/* The strikethrough "original price," only shown when it's
              actually higher than the current price. */}
          {product.originalPrice > product.price && (
            <span className="text-xs text-ink/50 line-through">{formatInr(product.originalPrice)}</span>
          )}
        </div>
        <AddToGiftListButton productName={product.name} />
      </div>
    </article>
  );
}
