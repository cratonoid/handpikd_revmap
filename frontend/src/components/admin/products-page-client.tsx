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
// ProductDetails has no is_deleted flag, only is_visible — so "Active" /
// "Hidden" here is exactly the vendors page's "Active" / "Deleted" toggle,
// just renamed to match the field it's actually driving. Clicking a row
// opens the popup in "edit" mode, pre-filled with that row's data; "+ Add
// new product" opens it in "add" mode.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { resolveMediaUrl } from "@/lib/api";
import { ProductFormModal } from "@/components/admin/product-form-modal";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import {
  descendantIdsById,
  fetchCategories,
  flattenCategories,
  namesForCategoryIds,
  type FlatCategory,
} from "@/lib/categories";
import { CubeIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; product: Product } | null;
type LoadState = "loading" | "loaded" | "error";
type View = "active" | "hidden";

export function ProductsPageClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [categoryDescendants, setCategoryDescendants] = useState<Map<string, string[]>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [view, setView] = useState<View>("active");

  const visibleProducts = products.filter((p) => (view === "hidden" ? !p.isVisible : p.isVisible));
  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchProducts(), fetchVendors(), fetchVendorsList(), fetchCategories()])
      .then(([productData, vendorData, vendorOptionData, categoryTree]) => {
        if (cancelled) return;
        setProducts(productData);
        setVendors(vendorData);
        setVendorOptions(vendorOptionData);
        setFlatCategories(flattenCategories(categoryTree));
        setCategoryDescendants(descendantIdsById(categoryTree));
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

  const categoryOptions = flatCategories.map((c) => ({
    value: c.id,
    label: c.name,
    depth: c.depth,
    descendantIds: categoryDescendants.get(c.id) ?? [],
  }));

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Products</h1>
          <p className={styles.pageSubtext}>Manage the product catalogue, pricing, and images.</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new product
        </Button>
      </div>

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
              <th className={styles.tableHeadCell}>Categories</th>
              <th className={styles.tableHeadCell}>Price</th>
              <th className={styles.tableHeadCell}>GST %</th>
              <th className={styles.tableHeadCell}>MOQ</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product, index) => {
              const vendor = vendorsById.get(product.vendorId);
              const categoryNames = namesForCategoryIds(flatCategories, product.categoryIds);
              const thumb = product.imagePaths[0];

              return (
                <tr
                  key={product.id}
                  onClick={() => setModalState({ mode: "edit", product })}
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
                  <td className={styles.tableCell}>{product.hsnCode}</td>
                  <td className={styles.tableCell}>{vendor?.registeredName ?? "—"}</td>
                  <td className={styles.tableCell}>
                    {categoryNames.length === 0 ? (
                      "—"
                    ) : (
                      <span className={styles.tableChipList}>
                        {categoryNames.map((name) => (
                          <span key={name} className={styles.tableChip}>
                            {name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={styles.tableCell}>
                    ₹{product.discountedPrice.toFixed(2)}
                    {product.discountedPrice !== product.actualPrice && (
                      <span className={styles.tableStrikePrice}>₹{product.actualPrice.toFixed(2)}</span>
                    )}
                  </td>
                  <td className={styles.tableCell}>{product.gstPerc}%</td>
                  <td className={styles.tableCell}>{product.moq}</td>
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
          categoryOptions={categoryOptions}
          onClose={() => setModalState(null)}
          onImagesChangedWithoutSave={handleImagesChangedWithoutSave}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
