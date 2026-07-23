import Image from "next/image";
import type { Product } from "@/lib/products-data";
import { AddToGiftListButton } from "@/components/products/add-to-gift-list-button";

export function ProductCard({ product }: { product: Product }) {
  const discountPct = Math.round(100 - (product.price / product.originalPrice) * 100);

  return (
    <article className="group flex h-full flex-col">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-cream-deep">
        <Image
          src={product.image}
          alt={product.alt}
          fill
          sizes="(min-width: 1280px) 22vw, (min-width: 1024px) 28vw, (min-width: 640px) 45vw, 90vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {discountPct > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-red px-2.5 py-1 text-xs font-semibold text-cream">
            -{discountPct}%
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-1 flex-col">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm leading-tight font-medium text-charcoal">
          {product.name}
        </h3>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-sm font-semibold text-charcoal">${product.price.toFixed(2)}</span>
          {product.originalPrice > product.price && (
            <span className="text-xs text-ink/50 line-through">${product.originalPrice.toFixed(2)}</span>
          )}
        </div>
        <AddToGiftListButton productName={product.name} />
      </div>
    </article>
  );
}
