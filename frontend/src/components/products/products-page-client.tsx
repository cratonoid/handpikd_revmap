"use client";

// ---------------------------------------------------------------------------
// <ProductsPageClient> — the whole interactive half of the /products page
// ---------------------------------------------------------------------------
// This is the biggest/most stateful component in the app. It owns ALL the
// filter state (which categories are checked, what price range is applied,
// which page of results is showing) and is the single place that actually
// computes the filtered + paginated product list shown in the grid. The
// sidebar filter controls (<CategoryFilter>, <PriceFilter>) are "dumb" —
// they don't know about filtering logic at all, they just display whatever
// state THIS component hands them and report user interactions back up via
// callback props.
//
// Both category AND price filters use a "pending vs. applied" split: ticking
// a checkbox or dragging the slider only updates the PENDING selection —
// the grid keeps showing the last APPLIED results until the single "Apply
// Filters" button (at the bottom of the sidebar) is pressed, which commits
// both at once.
//
// Rendered by src/app/products/page.tsx (a Server Component) — this file is
// the Client Component that takes over from there. Styling lives in
// src/styles/products.module.css.
//
// Unlike the old mock-data version, the category tree and product list now
// come from the real backend (GET /products/get_public_categories and GET
// /products/get_public_products — see lib/public-products.ts) via a
// fetch-on-mount effect, mirroring components/brand-catalogues/
// brand-catalogues-page-client.tsx's loading/error/loaded pattern.
import { useEffect, useMemo, useState } from "react";
import {
  buildDescendantIndex,
  collectIds,
  fetchPublicCategories,
  fetchPublicProducts,
  formatInr,
  type CategoryNode,
  type Product,
} from "@/lib/public-products";
import { CategoryFilter } from "@/components/products/category-filter";
import { PriceFilter } from "@/components/products/price-filter";
import { ProductCard } from "@/components/products/product-card";
import { Eyebrow } from "@/components/eyebrow";
import { SlidersIcon, XMarkIcon, ArrowRightIcon } from "@/components/icons";
import styles from "@/styles/products.module.css";

type LoadState = "loading" | "loaded" | "error";

// How many products to show per page of the grid.
const PAGE_SIZE = 12;

// Compares two Sets for equality (same size, same members) — plain `===`
// never works for Sets/objects since it only checks "is this the exact same
// object in memory," not "do these contain the same values." Used below to
// tell whether the pending category selection actually differs from what's
// applied.
function setsAreEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function ProductsPageClient() {
  // The real category tree + product list, fetched once on mount from the
  // backend's public endpoints. Empty until `loadState` becomes "loaded".
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  // Category checkboxes: PENDING is what's currently ticked on screen;
  // APPLIED is what's actually filtering the grid. Same split as price,
  // below.
  const [pendingCheckedIds, setPendingCheckedIds] = useState<Set<string>>(new Set());
  const [appliedCheckedIds, setAppliedCheckedIds] = useState<Set<string>>(new Set());

  // The slider/inputs move `pendingPriceRange` immediately; the grid only
  // re-filters once "Apply Filters" commits it to `appliedPriceRange`. Both
  // start at [0, 0] and get set to the real min/max (see priceBoundsForProducts
  // below) once the fetch below resolves — see the effect's `.then()`.
  const [pendingPriceRange, setPendingPriceRange] = useState<[number, number]>([0, 0]);
  const [appliedPriceRange, setAppliedPriceRange] = useState<[number, number]>([0, 0]);

  // The exact min/max price across a product list, rounded OUT to whole
  // numbers (`Math.floor`/`Math.ceil`) so the slider's ends are clean round
  // values. Falls back to [0, 0] for an empty list.
  function priceBoundsForProducts(list: Product[]): [number, number] {
    const bounds = list.reduce(
      (acc, p) => ({ min: Math.min(acc.min, p.price), max: Math.max(acc.max, p.price) }),
      { min: Infinity, max: 0 },
    );
    return Number.isFinite(bounds.min) ? [Math.floor(bounds.min), Math.ceil(bounds.max)] : [0, 0];
  }

  useEffect(() => {
    Promise.all([fetchPublicProducts(), fetchPublicCategories()])
      .then(([productsData, categories]) => {
        setProducts(productsData);
        setCategoryTree(categories);
        const bounds = priceBoundsForProducts(productsData);
        setPendingPriceRange(bounds);
        setAppliedPriceRange(bounds);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, []);

  const [PRICE_MIN, PRICE_MAX] = useMemo(() => priceBoundsForProducts(products), [products]);

  // Every category id's own id + all descendant ids, built from the fetched
  // tree — see buildDescendantIndex in lib/public-products.ts for why this
  // is needed (a product is tagged with specific category ids, not a full
  // ancestor path, so checking a parent category needs to expand out to its
  // whole subtree to match anything).
  const descendantIndex = useMemo(() => buildDescendantIndex(categoryTree), [categoryTree]);

  // Whether the mobile slide-in filter drawer is currently open (only
  // relevant on small screens — see the JSX further down).
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Which page of (already filtered) results is currently showing.
  const [page, setPage] = useState(1);

  // True whenever the pending price differs from what's applied.
  const priceIsPending =
    pendingPriceRange[0] !== appliedPriceRange[0] || pendingPriceRange[1] !== appliedPriceRange[1];
  // True whenever the pending category selection differs from what's applied.
  const categoryIsPending = !setsAreEqual(pendingCheckedIds, appliedCheckedIds);
  // True if EITHER filter has an unapplied change — drives the "Apply
  // Filters" button's active/disabled look and the warning message below.
  const anyFilterIsPending = priceIsPending || categoryIsPending;

  // Passed down to <CategoryFilter> as its `onToggle` prop — updates the
  // PENDING selection only; the grid doesn't change until Apply is pressed.
  // Same "unfold one level at a time" idea as the hamper inquiry tree
  // (components/hamper-inquiry/inquiry-tree-selector.tsx): checking a node
  // only checks THAT node, so CategoryFilter's recursive render only reveals
  // its direct children, not the whole subtree at once — a child's own
  // children only show up once it's clicked too. Unchecking still clears the
  // node's whole subtree (via collectIds) so any deeper picks made while it
  // was open don't linger as orphaned state once it's collapsed again.
  //
  // This doesn't need to also check descendant ids for filtering to work —
  // expandedAppliedCategoryIds below already expands each applied id out to
  // its full subtree via descendantIndex, so checking "Drinkware" alone
  // still matches products tagged under "Mugs", "Bottles", etc.
  function handleToggle(node: CategoryNode) {
    setPendingCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        // collectIds returns the node's own id plus all descendant ids —
        // see lib/public-products.ts.
        collectIds(node).forEach((id) => next.delete(id));
      } else {
        next.add(node.id);
      }
      return next;
    });
  }

  // Commits BOTH pending category and pending price selections to the
  // "applied" state that actually filters the grid, resets back to page 1
  // (so you don't land on a now-empty page 3 after narrowing the results),
  // and — on mobile, where this button also lives inside the slide-in
  // drawer — closes the drawer. Calling setMobileFiltersOpen(false) here is
  // harmless on desktop, since the drawer is never open there anyway.
  function applyFilters() {
    setAppliedCheckedIds(new Set(pendingCheckedIds));
    setAppliedPriceRange(pendingPriceRange);
    setPage(1);
    setMobileFiltersOpen(false);
  }

  // Resets every filter (categories AND price, both pending and applied)
  // back to their defaults, and back to page 1.
  function clearFilters() {
    setPendingCheckedIds(new Set());
    setAppliedCheckedIds(new Set());
    setPendingPriceRange([PRICE_MIN, PRICE_MAX]);
    setAppliedPriceRange([PRICE_MIN, PRICE_MAX]);
    setPage(1);
  }

  // The applied category selection, expanded out to every id it should
  // match against (each checked id's own id + all of its descendants) —
  // computed once here rather than per-product inside the filter below.
  const expandedAppliedCategoryIds = useMemo(() => {
    const expanded = new Set<string>();
    appliedCheckedIds.forEach((id) => {
      (descendantIndex.get(id) ?? [id]).forEach((matchId) => expanded.add(matchId));
    });
    return expanded;
  }, [appliedCheckedIds, descendantIndex]);

  // The full filtered list (before pagination), based on the APPLIED
  // selections only. `useMemo` recomputes this only when the applied
  // filters actually change, not on every render.
  const filtered = useMemo(() => {
    return products.filter((p) => {
      const inPrice = p.price >= appliedPriceRange[0] && p.price <= appliedPriceRange[1];
      const inCategory =
        appliedCheckedIds.size === 0 || p.categoryIds.some((id) => expandedAppliedCategoryIds.has(id));
      return inPrice && inCategory;
    });
  }, [products, appliedCheckedIds, appliedPriceRange, expandedAppliedCategoryIds]);

  // How many pages the current filtered list needs, and which slice of it
  // belongs on the current page. `Math.max(1, ...)` guarantees there's
  // always at least 1 page, even when `filtered` is empty (avoiding a
  // "page 0 of 0" edge case). `.slice(start, end)` pulls out just the 12
  // products for the current page — e.g. page 1 = products[0..12), page 2 =
  // products[12..24), etc.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // A single number representing "how many filters are currently applied,"
  // shown as a small badge on the mobile Filters button.
  const activeCount =
    appliedCheckedIds.size + (appliedPriceRange[0] !== PRICE_MIN || appliedPriceRange[1] !== PRICE_MAX ? 1 : 0);

  // The contents of the filter sidebar, built ONCE here as a JSX variable
  // and reused in TWO places below: the desktop sticky <aside>, and the
  // mobile slide-in drawer.
  const filterPanel = (
    <>
      {activeCount > 0 && (
        <div className={styles.clearAllRow}>
          <button type="button" onClick={clearFilters} className={styles.clearAllButton}>
            Clear all
          </button>
        </div>
      )}

      <div className={styles.priceSection}>
        <Eyebrow as="p">Price</Eyebrow>
        <p className={styles.priceHint}>The highest price is {formatInr(PRICE_MAX)}</p>
        <div className={styles.priceControlWrap}>
          <PriceFilter
            min={PRICE_MIN}
            max={PRICE_MAX}
            value={pendingPriceRange}
            onChange={setPendingPriceRange}
            pending={priceIsPending}
          />
        </div>
      </div>

      <div className={styles.categorySection}>
        <Eyebrow as="p">Category</Eyebrow>
        <div className={styles.categoryTreeWrap}>
          <CategoryFilter nodes={categoryTree} checkedIds={pendingCheckedIds} onToggle={handleToggle} />
        </div>
      </div>

      {anyFilterIsPending && (
        <p role="status" className={styles.pendingNotice}>
          Results below don&apos;t reflect these changes yet.
        </p>
      )}

      {/* The single "Apply Filters" button — now covers BOTH category and
          price, and lives at the BOTTOM of the whole panel (moved down
          from its old spot directly under the price slider). `position:
          sticky; bottom: 0` (`.applyButton`) keeps it reachable at the
          bottom of the sidebar's own scroll area even when the category
          tree is long enough to scroll. */}
      <button
        type="button"
        onClick={applyFilters}
        disabled={!anyFilterIsPending}
        className={`${styles.applyButton} ${anyFilterIsPending ? styles.applyButtonActive : styles.applyButtonInactive}`}
      >
        Apply Filters
        {anyFilterIsPending && <ArrowRightIcon className="h-4 w-4" />}
      </button>
    </>
  );

  if (loadState === "loading") {
    return (
      <div className={styles.pageLayout}>
        <p className={styles.emptyState}>Loading products…</p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className={styles.pageLayout}>
        <p className={styles.emptyState}>Failed to load products.</p>
      </div>
    );
  }

  return (
    <div className={styles.pageLayout}>
      {/* Mobile filter trigger + result count — only visible below `lg`. */}
      <div className={styles.mobileTopBar}>
        <button type="button" onClick={() => setMobileFiltersOpen(true)} className={styles.mobileFilterTrigger}>
          <SlidersIcon className="h-4 w-4" />
          Filters
          {activeCount > 0 && <span className={styles.filterBadgeCount}>{activeCount}</span>}
        </button>
        <p className={styles.resultCount}>{filtered.length} products</p>
      </div>

      {/* Desktop sidebar — sticky + independently scrollable from the
          grid, with a beige gradient fading out on the right to visually
          separate it from the product grid. Hidden entirely below `lg` —
          the mobile drawer below takes over there instead. */}
      <aside className={styles.sidebar}>
        <p className={styles.sidebarHeading}>Filters</p>
        {filterPanel}
      </aside>

      {/* Mobile filter drawer — only rendered at all while
          `mobileFiltersOpen` is true. The shared `filterPanel` above
          already includes its own "Apply Filters" button, which applies
          AND closes this drawer — so there's no separate bottom button
          here anymore. */}
      {mobileFiltersOpen && (
        <div className={styles.drawerRoot}>
          <div className={styles.drawerBackdrop} onClick={() => setMobileFiltersOpen(false)} aria-hidden="true" />
          <div className={styles.drawerPanel}>
            <div className={styles.drawerHeader}>
              <p className={styles.drawerTitle}>Filters</p>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
                className={styles.drawerCloseButton}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className={styles.drawerScroll}>{filterPanel}</div>
          </div>
        </div>
      )}

      <div>
        <div className={styles.desktopResultRow}>
          <p className={styles.resultCount}>{filtered.length} products</p>
        </div>

        {/* If filtering leaves NO products at all, show a helpful empty
            state instead of a blank grid. Otherwise render the current
            PAGE of the filtered list (12 at a time). */}
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateHeading}>No products match your filters</p>
            <button type="button" onClick={clearFilters} className={styles.emptyStateButton}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className={styles.productGrid}>
              {paginated.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Pagination controls — only shown when there's more than one
                page. `disabled` on Previous/Next prevents going past
                either end instead of hiding the buttons, which keeps the
                control's position stable as you page through. */}
            {totalPages > 1 && (
              <nav aria-label="Product pages" className={styles.paginationNav}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={styles.paginationButton}
                >
                  Previous
                </button>
                <p className={styles.paginationText}>
                  Page {page} of {totalPages}
                </p>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className={styles.paginationButton}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
