"use client";

// ---------------------------------------------------------------------------
// <ProductsPageClient> — the whole interactive half of the /products page
// ---------------------------------------------------------------------------
// This is the biggest/most stateful component in the app. It owns ALL the
// filter state (which categories are checked, what price range is applied)
// and is the single place that actually computes the filtered product list
// shown in the grid. The sidebar filter controls (<CategoryFilter>,
// <PriceFilter>) are "dumb" — they don't know about filtering logic at all,
// they just display whatever state THIS component hands them and report
// user interactions back up via callback props.
//
// Rendered by src/app/products/page.tsx (a Server Component) underneath its
// static banner — this file is the Client Component that takes over from
// there.
import { useMemo, useState } from "react";
import { categoryTree, products, priceBounds, collectIds, formatInr, type CategoryNode } from "@/lib/products-data";
import { CategoryFilter } from "@/components/products/category-filter";
import { PriceFilter } from "@/components/products/price-filter";
import { ProductCard } from "@/components/products/product-card";
import { Eyebrow } from "@/components/eyebrow";
import { SlidersIcon, XMarkIcon } from "@/components/icons";

// `priceBounds` (from products-data.ts) is the exact min/max price across
// every real product, which could be a fractional-looking number depending
// on the data. `Math.floor`/`Math.ceil` round it OUT to whole numbers so the
// slider's ends are clean round values. These are computed once, at module
// load time (not inside the component), since they never change while the
// app is running.
const PRICE_MIN = Math.floor(priceBounds.min);
const PRICE_MAX = Math.ceil(priceBounds.max);

export function ProductsPageClient() {
  // The Set of every currently-checked category id (e.g. {"drinkware",
  // "mugs"}). A Set (rather than an array) is used because checking/adding/
  // removing a single id is fast and the order of ids never matters here.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // The slider/inputs move `pendingPriceRange` immediately; the grid only
  // re-filters once "Apply Filter" commits it to `appliedPriceRange`.
  //
  // Splitting this into TWO separate pieces of state (pending vs. applied)
  // is what powers the whole "drag the slider, see a red 'pending' warning,
  // click Apply to actually filter" flow: `pendingPriceRange` is what the
  // slider visually shows and updates instantly as you drag; the product
  // grid below is filtered using `appliedPriceRange` instead, which only
  // changes when the Apply button is clicked. Comparing the two tells us
  // whether there's an unapplied change (see `priceIsPending` below).
  const [pendingPriceRange, setPendingPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [appliedPriceRange, setAppliedPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);

  // Whether the mobile slide-in filter drawer is currently open (only
  // relevant on small screens — see the JSX further down).
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // True whenever the pending slider position differs from what's actually
  // applied to the grid — drives the red slider/border/warning-text styling
  // in the Price section below.
  const priceIsPending =
    pendingPriceRange[0] !== appliedPriceRange[0] || pendingPriceRange[1] !== appliedPriceRange[1];

  // Passed down to <CategoryFilter> as its `onToggle` prop. Runs every time
  // a category row is clicked.
  function handleToggle(node: CategoryNode) {
    // `setCheckedIds(prev => ...)` is the "updater function" form of
    // useState's setter — instead of computing the new value directly, you
    // give React a function that receives the PREVIOUS state and returns
    // the new state. This is the safer way to update state that depends on
    // its own previous value.
    setCheckedIds((prev) => {
      // Copy the previous Set into a new one (`new Set(prev)`) rather than
      // mutating `prev` directly — React needs a genuinely NEW object to
      // notice the state changed and re-render.
      const next = new Set(prev);
      if (next.has(node.id)) {
        // Already checked -> uncheck it, AND every category nested inside
        // it (collectIds returns the node's own id plus all descendant
        // ids — see products-data.ts). This is what makes un-checking
        // "Drinkware" also un-check "Mugs", "Bottles", etc. underneath it.
        collectIds(node).forEach((id) => next.delete(id));
      } else {
        // Not checked yet -> check just this one node (its children start
        // unchecked and only become checkable once this one is expanded —
        // see category-filter.tsx).
        next.add(node.id);
      }
      return next;
    });
  }

  // Called when the "Apply Filter" button is clicked — commits the pending
  // slider position to the value that actually filters the grid.
  function applyPriceFilter() {
    setAppliedPriceRange(pendingPriceRange);
  }

  // Resets every filter (categories AND price, both pending and applied)
  // back to their defaults. Used by "Clear all", the empty-results "Clear
  // filters" button, and indirectly wherever those appear.
  function clearFilters() {
    setCheckedIds(new Set());
    setPendingPriceRange([PRICE_MIN, PRICE_MAX]);
    setAppliedPriceRange([PRICE_MIN, PRICE_MAX]);
  }

  // The actual filtered list of products to display. `useMemo(fn, deps)`
  // re-runs `fn` and recalculates the result ONLY when something in `deps`
  // has changed since the last render — otherwise it reuses the previous
  // result instead of recomputing it from scratch on every single render
  // (e.g. even ones triggered by unrelated state like `mobileFiltersOpen`).
  // With 59 products this recalculation is cheap either way, but `useMemo`
  // is a common/idiomatic pattern for exactly this "derive one value from
  // some state" situation.
  const filtered = useMemo(() => {
    return products.filter((p) => {
      const inPrice = p.price >= appliedPriceRange[0] && p.price <= appliedPriceRange[1];
      // A product matches the category filter if NO categories are
      // checked at all (`checkedIds.size === 0`, meaning "show
      // everything"), OR if any id in its own category path is in the
      // checked set. `.some()` returns true as soon as it finds ONE
      // matching id, without needing to check the rest.
      const inCategory = checkedIds.size === 0 || p.categoryPath.some((id) => checkedIds.has(id));
      return inPrice && inCategory;
    });
  }, [checkedIds, appliedPriceRange]); // recompute only when these two actually change

  // A single number representing "how many filters are currently active,"
  // shown as a small badge on the mobile Filters button. Category filters
  // count individually; the price range counts as at most 1 (it's either
  // at its default or it isn't — there's no "how many" for a single range).
  const activeCount =
    checkedIds.size + (appliedPriceRange[0] !== PRICE_MIN || appliedPriceRange[1] !== PRICE_MAX ? 1 : 0);

  // The contents of the filter sidebar, built ONCE here as a JSX variable
  // and then reused in TWO different places below: the desktop sticky
  // <aside>, and the mobile slide-in drawer. Defining it once avoids
  // duplicating this markup (and risking the two copies drifting out of
  // sync) across both layouts.
  const filterPanel = (
    <>
      {activeCount > 0 && (
        <div className="flex items-center justify-end pb-3">
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-semibold text-charcoal hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="border-b border-border py-5">
        <Eyebrow as="p">Price</Eyebrow>
        <p className="mt-1 text-xs text-ink/60">The highest price is {formatInr(PRICE_MAX)}</p>
        <div className="mt-5">
          <PriceFilter
            min={PRICE_MIN}
            max={PRICE_MAX}
            value={pendingPriceRange} // the slider always reflects the PENDING value, not the applied one
            onChange={setPendingPriceRange}
            pending={priceIsPending}
          />
        </div>

        {priceIsPending && (
          <p role="status" className="mt-3 text-xs font-medium text-red">
            Results below use the previous price range.
          </p>
        )}

        <button
          type="button"
          onClick={applyPriceFilter}
          disabled={!priceIsPending} // nothing to apply if the slider hasn't actually moved
          className={`mt-4 flex min-h-10 w-full items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors duration-200 ${
            priceIsPending
              ? "bg-button-primary text-cream hover:bg-button-primary-hover" // active/clickable look
              : "bg-button-tertiary text-charcoal/40" // muted/disabled look
          }`}
        >
          Apply Filter
        </button>
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
    // Two-column grid on large screens (fixed 240px sidebar + flexible
    // product area); stacks to one column below `lg`, where the sidebar is
    // replaced entirely by the mobile drawer further down.
    <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 sm:py-6 lg:grid lg:grid-cols-[240px_1fr] lg:items-start lg:gap-6">
      {/* Mobile filter trigger + result count — only visible below `lg`. */}
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

      {/* Desktop sidebar — sticky + independently scrollable from the
          grid. `lg:sticky lg:top-24` pins it near the top of the viewport
          once you scroll past it; `lg:max-h-[calc(100vh-6rem)]
          lg:overflow-y-auto` caps its own height and gives IT a separate
          scrollbar, so a long category list scrolls independently from the
          (potentially much longer) product grid next to it. Hidden
          entirely below `lg` — the mobile drawer below takes over there
          instead. */}
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-5">
        {filterPanel}
      </aside>

      {/* Mobile filter drawer — only rendered at all while
          `mobileFiltersOpen` is true. */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          {/* The semi-transparent backdrop covering the rest of the page.
              Clicking it closes the drawer, same as the explicit close
              button. */}
          <div
            className="absolute inset-0 bg-charcoal/50"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          {/* The actual sliding panel, pinned to the left edge of the
              screen. */}
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
            {/* Reuses the exact same `filterPanel` JSX defined above — the
                desktop sidebar and this mobile drawer are never both
                visible at once (one is CSS-hidden depending on screen
                width), so sharing one copy of the controls is safe and
                avoids duplicating all that markup. */}
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

        {/* If filtering leaves NO products at all, show a helpful empty
            state instead of a blank grid. Otherwise render the actual
            grid. 2 columns on mobile, up to 4 on extra-large screens. */}
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
