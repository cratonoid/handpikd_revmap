"use client";

// ---------------------------------------------------------------------------
// <ProductsPageClient> — the interactive half of /admin/products
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendors-page-client.tsx. Owns the product table
// (fetched from GET /admin/get_product_details, see lib/products.ts) plus
// the vendor list and category tree it needs to show human-readable names
// instead of raw vendor_id / category_ids, and to pass on as options to the
// add/edit popup's vendor single-select and category multiselect
// (components/admin/product-form-modal.tsx).
//
// Two separate vendor fetches: the full get_vendor_details list (`vendors`)
// resolves the table's vendor column, including for products whose vendor
// has since been soft-deleted; the lightweight get_vendors_list
// (`vendorOptions`) feeds the popup's picker, which should only offer active
// vendors.
//
// Four tabs over three flags on ProductDetails (see lib/products.ts), so
// every product lands in exactly one of them:
//   Active   — live and on the storefront   (is_visible, not is_deleted)
//   Hidden   — live but off the storefront  (!is_visible, not is_deleted)
//   Deleted  — soft-deleted, restorable     (is_deleted, whatever is_visible)
//   Unbilled — stock bought with no bill    (is_unbilled, not is_deleted)
// is_deleted wins over is_visible: a deleted product belongs under Deleted
// whether it was visible or not, which is why the Deleted filter is checked
// first. is_unbilled is checked next, ahead of the visible/hidden split:
// those products are always hidden and would otherwise fill the Hidden tab
// with local-market goods that have no HSN code, no images and no price.
//
// The Unbilled tab is READ-ONLY — its rows don't open the edit popup. That
// popup is the billed product form: it requires an HSN code and a
// discounted price below a positive list price, none of which an unbilled
// product has or should be forced to invent. These are created and edited
// from the unbilled purchase they came in on (see
// components/admin/unbilled-purchase-order-form-modal.tsx). The list itself is deliberately the unfiltered
// get_product_details, so the tabs are pure client-side splits of one fetch.
// The tabs share one table; the only per-tab differences are that Hidden and
// Unbilled drop the MOQ column (an unbilled product has no meaningful
// minimum order quantity) and that Unbilled's rows don't open the popup.
//
// Clicking a row opens the popup in "edit" mode, pre-filled with that row's
// data; "+ Add new product" opens it in "add" mode.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { resolveMediaUrl } from "@/lib/api";
import { ProductFormModal } from "@/components/admin/product-form-modal";
import { CategoryTreeSelect } from "@/components/admin/category-tree-select";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import { fetchCategories, descendantIdsById, type CategoryNode } from "@/lib/categories";
import { CubeIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; product: Product } | null;
type LoadState = "loading" | "loaded" | "error";
type View = "active" | "hidden" | "deleted" | "unbilled";

export function ProductsPageClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [view, setView] = useState<View>("active");

  // Unfolding category filter above the table — same expand-on-check tree
  // as the product form's "Categories" field (category-tree-select.tsx),
  // reused here for browsing/filtering instead of tagging. Picking a
  // category still only picks that one node (see category-tree-select.tsx's
  // module comment), but matching below expands it out to its full subtree
  // via descendantIdsById, mirroring the storefront filter's
  // expandedAppliedCategoryIds (products-page-client.tsx under
  // components/products) so picking a parent still surfaces products only
  // tagged with one of its children.
  const [categoryFilterIds, setCategoryFilterIds] = useState<string[]>([]);
  const descendantsById = useMemo(() => descendantIdsById(categoryTree), [categoryTree]);
  const expandedFilterIds = useMemo(() => {
    const expanded = new Set<string>();
    categoryFilterIds.forEach((id) => {
      expanded.add(id);
      (descendantsById.get(id) ?? []).forEach((descendantId) => expanded.add(descendantId));
    });
    return expanded;
  }, [categoryFilterIds, descendantsById]);

  const isUnbilledView = view === "unbilled";
  const visibleProducts = products
    .filter((p) => {
      if (view === "deleted") return p.isDeleted;
      if (p.isDeleted) return false;
      // Ahead of the visible/hidden split, not inside it: an unbilled
      // product is always hidden, so without this every one of them would
      // also show up under Hidden.
      if (p.isUnbilled) return isUnbilledView;
      return !isUnbilledView && p.isVisible === (view === "active");
    })
    .filter((p) => categoryFilterIds.length === 0 || p.categoryIds.some((id) => expandedFilterIds.has(id)));
  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchProducts(), fetchVendors(), fetchVendorsList(), fetchCategories()])
      .then(([productData, vendorData, vendorOptionData, categories]) => {
        if (cancelled) return;
        setProducts(productData);
        setVendors(vendorData);
        setVendorOptions(vendorOptionData);
        setCategoryTree(categories);
        setLoadState("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(product: Product) {
    setProducts((prev) => {
      const index = prev.findIndex((p) => p.id === product.id);
      if (index === -1) {
        return [...prev, product];
      }
      const next = [...prev];
      next[index] = product;
      return next;
    });
    setModalState(null);
  }

  // Permanent delete leaves nothing to show, so the row goes rather than
  // being updated the way handleSaved updates one after a soft delete or a
  // restore.
  function handlePermanentlyDeleted(productId: number) {
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    setModalState(null);
  }

  // The modal deletes an already-saved image immediately (not gated behind
  // Save) — if the admin then closes without saving, this local `products`
  // list is left pointing at an image that's already gone server-side. Since
  // the modal only reconstructs a full Product on Save, a real re-fetch
  // (rather than trying to patch the stale entry's imagePaths by hand) is
  // what actually reflects the truth.
  function handleImagesChangedWithoutSave() {
    setModalState(null);
    fetchProducts()
      .then(setProducts)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the delete itself already succeeded.
      });
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Products</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new product
        </Button>
      </div>

      {/* Status toggle and category filter share one control row. They used to
          stack, and the category select carried a "FILTER BY CATEGORY" caption
          above it — together nearly 150px of chrome above the first product.
          The caption is now sr-only: the placeholder already reads "All
          categories", so it was labelling something self-evident. */}
      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Product status">
          <button
            type="button"
            role="tab"
            aria-selected={view === "active"}
            onClick={() => setView("active")}
            className={`${styles.viewToggleButton} ${view === "active" ? styles.viewToggleButtonActive : ""}`}
          >
            Active products
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "hidden"}
            onClick={() => setView("hidden")}
            className={`${styles.viewToggleButton} ${view === "hidden" ? styles.viewToggleButtonActive : ""}`}
          >
            Hidden products
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "deleted"}
            onClick={() => setView("deleted")}
            className={`${styles.viewToggleButton} ${view === "deleted" ? styles.viewToggleButtonActive : ""}`}
          >
            Deleted
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isUnbilledView}
            onClick={() => setView("unbilled")}
            className={`${styles.viewToggleButton} ${isUnbilledView ? styles.viewToggleButtonActive : ""}`}
          >
            Unbilled
          </button>
        </div>

        <div className={styles.filterToggleRowSelect}>
          <CategoryTreeSelect
            label="Filter by category"
            hideLabel
            placeholder="All categories"
            tree={categoryTree}
            selectedValues={categoryFilterIds}
            onChange={setCategoryFilterIds}
          />
        </div>

        {categoryFilterIds.length > 0 && (
          <Button type="button" variant="tertiary" onClick={() => setCategoryFilterIds([])}>
            Clear category filter
          </Button>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}></th>
              <th className={styles.tableHeadCell}>Product</th>
              <th className={styles.tableHeadCell}>HSN</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Vendor Rate</th>
              <th className={styles.tableHeadCell}>Price</th>
              {view !== "hidden" && !isUnbilledView && <th className={styles.tableHeadCell}>MOQ</th>}
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product, index) => {
              const vendor = vendorsById.get(product.vendorId);
              const thumb = product.imagePaths[0];

              return (
                <tr
                  key={product.id}
                  // No edit popup on the Unbilled tab — see the note at the
                  // top of this file on why that form can't take one of
                  // these.
                  onClick={isUnbilledView ? undefined : () => setModalState({ mode: "edit", product })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={styles.tableCell}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary/dynamic URL, not an optimizable local/remote asset
                      <img src={resolveMediaUrl(thumb)} alt="" className={styles.tableThumb} />
                    ) : (
                      <div className={styles.tableThumbEmpty}>
                        <CubeIcon className="h-4 w-4" />
                      </div>
                    )}
                  </td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{product.productName}</td>
                  {/* An unbilled product has no HSN code at all, so this
                      shows an em dash rather than an empty cell. */}
                  <td className={styles.tableCell}>{product.hsnCode || "—"}</td>
                  <td className={styles.tableCell}>{vendor?.registeredName ?? "—"}</td>
                  <td className={styles.tableCell}>₹{product.vendorRate.toFixed(2)}</td>
                  <td className={styles.tableCell}>
                    ₹{product.discountedPrice.toFixed(2)}
                    {product.discountedPrice !== product.actualPrice && (
                      <span className={styles.tableStrikePrice}>₹{product.actualPrice.toFixed(2)}</span>
                    )}
                  </td>
                  {view !== "hidden" && !isUnbilledView && (
                    <td className={styles.tableCell}>{product.moq}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading products…</p>}
        {loadState === "error" && <p className={styles.pageSubtext}>No products available.</p>}
        {loadState === "loaded" && visibleProducts.length === 0 && (
          <p className={styles.pageSubtext}>No products available.</p>
        )}
      </div>

      {modalState && (
        <ProductFormModal
          mode={modalState.mode}
          initialProduct={modalState.mode === "edit" ? modalState.product : undefined}
          vendors={vendorOptions}
          categoryTree={categoryTree}
          onClose={() => setModalState(null)}
          onImagesChangedWithoutSave={handleImagesChangedWithoutSave}
          onPermanentlyDeleted={handlePermanentlyDeleted}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
