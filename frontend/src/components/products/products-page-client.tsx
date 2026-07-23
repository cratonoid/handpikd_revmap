"use client";

import { useMemo, useState } from "react";
import { categoryTree, products, priceBounds, collectIds, type CategoryNode } from "@/lib/products-data";
import { CategoryFilter } from "@/components/products/category-filter";
import { PriceFilter } from "@/components/products/price-filter";
import { ProductCard } from "@/components/products/product-card";
import { Eyebrow } from "@/components/eyebrow";
import { SlidersIcon, XMarkIcon } from "@/components/icons";

const PRICE_MIN = Math.floor(priceBounds.min);
const PRICE_MAX = Math.ceil(priceBounds.max);

export function ProductsPageClient() {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  function handleToggle(node: CategoryNode) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        collectIds(node).forEach((id) => next.delete(id));
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  function clearFilters() {
    setCheckedIds(new Set());
    setPriceRange([PRICE_MIN, PRICE_MAX]);
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const inPrice = p.price >= priceRange[0] && p.price <= priceRange[1];
      const inCategory = checkedIds.size === 0 || p.categoryPath.some((id) => checkedIds.has(id));
      return inPrice && inCategory;
    });
  }, [checkedIds, priceRange]);

  const activeCount = checkedIds.size + (priceRange[0] !== PRICE_MIN || priceRange[1] !== PRICE_MAX ? 1 : 0);

  const filterPanel = (
    <>
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="font-display text-lg font-semibold text-charcoal">Filters</h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-semibold text-charcoal hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="border-b border-border py-6">
        <Eyebrow as="p">Price</Eyebrow>
        <p className="mt-1 text-xs text-ink/60">The highest price is ${PRICE_MAX.toFixed(2)}</p>
        <div className="mt-5">
          <PriceFilter min={PRICE_MIN} max={PRICE_MAX} value={priceRange} onChange={setPriceRange} />
        </div>
      </div>

      <div className="py-6">
        <Eyebrow as="p">Category</Eyebrow>
        <div className="mt-4">
          <CategoryFilter nodes={categoryTree} checkedIds={checkedIds} onToggle={handleToggle} />
        </div>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8 sm:py-10 lg:grid lg:grid-cols-[280px_1fr] lg:items-start lg:gap-10">
      {/* Mobile filter trigger + result count */}
      <div className="mb-5 flex items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() => setMobileFiltersOpen(true)}
          className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-charcoal"
        >
          <SlidersIcon className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-charcoal px-1.5 py-0.5 text-xs text-cream">{activeCount}</span>
          )}
        </button>
        <p className="text-sm text-ink/60">{filtered.length} products</p>
      </div>

      {/* Desktop sidebar — sticky + independently scrollable from the grid */}
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-5">
        {filterPanel}
      </aside>

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-charcoal/50"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-[85vw] max-w-sm flex-col bg-cream px-5 pt-5 pb-8 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-lg font-semibold text-charcoal">Filters</p>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className="flex h-11 w-11 items-center justify-center rounded-full text-charcoal"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{filterPanel}</div>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(false)}
              className="mt-4 min-h-11 rounded-full bg-button-primary px-6 py-3 text-sm font-semibold text-cream"
            >
              Show {filtered.length} products
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-6 hidden items-center justify-between lg:flex">
          <p className="text-sm text-ink/60">{filtered.length} products</p>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-24 text-center">
            <p className="font-display text-lg font-semibold text-charcoal">No products match your filters</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-sm font-semibold text-charcoal hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
