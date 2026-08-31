"use client";

// ---------------------------------------------------------------------------
// <CataloguesPageClient> — the interactive half of /admin/catalogues
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendors-page-client.tsx. Owns the catalogue table
// (fetched from GET /admin/get_catalogue_details, see lib/catalogues.ts) and
// the add/edit popup (catalogue-form-modal.tsx). Clicking "+ Add new
// catalogue" opens the popup in "add" mode; double-clicking an existing row
// opens it in "edit" mode, pre-filled with that row's data.
//
// Vendor names and category names are resolved locally via id->name maps
// built from fetchVendorsList/fetchCategories, the same lightweight lists
// the form modal's dropdowns use — avoids a second, heavier fetch just for
// display labels. `categoryOptions` passed to the modal is the raw
// fetchCategories() result used AS-IS: its top-level array is already just
// the root/main categories (parent_id === null), which is what a
// catalogue's category_ids should be picked from. It's a flat list, not the
// nested tree the product form's picker uses — no depth/descendantIds — so
// picking a main category never drags its subcategories in with it.
//
// Hidden catalogues (is_visible off — set from the form modal's "Visible"
// checkbox) stay in this table like any other; they're marked with a badge
// next to the name rather than split into their own tab the way hidden
// products are. Hiding is the only non-destructive way to take a catalogue
// off the storefront, since a catalogue delete is permanent.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CatalogueFormModal } from "@/components/admin/catalogue-form-modal";
import { fetchCatalogues, type Catalogue } from "@/lib/catalogues";
import { fetchCategories, type CategoryNode } from "@/lib/categories";
import { fetchVendorsList, type VendorOption } from "@/lib/vendors";
import type { MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { DiaryIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; catalogue: Catalogue } | null;
type LoadState = "loading" | "loaded" | "error";

const CATALOGUE_TYPE_LABELS: Record<string, string> = {
  brand: "Brand",
  regular: "Regular",
};

export function CataloguesPageClient() {
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [rootCategories, setRootCategories] = useState<CategoryNode[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);

  // Neither add/update/delete_catalogue_details returns the saved/deleted
  // record, so every mutation just re-runs this full refetch rather than
  // trying to splice a locally-fabricated row into place — same as the
  // initial mount's load.
  function loadAll(): Promise<void> {
    return Promise.all([fetchCatalogues(), fetchVendorsList(), fetchCategories()])
      .then(([catalogueData, vendorData, categoryTree]) => {
        setCatalogues(catalogueData);
        setVendors(vendorData);
        setRootCategories(categoryTree);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const vendorsById = new Map(vendors.map((v) => [String(v.id), v.name]));
  const categoriesById = new Map(rootCategories.map((c) => [c.id, c.name]));

  const categoryOptions: MultiSelectOption[] = rootCategories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  function handleSaved() {
    void loadAll();
    setModalState(null);
  }

  function handleDeleted() {
    void loadAll();
    setModalState(null);
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Catalogues</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new catalogue
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Catalogue</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Categories</th>
              <th className={styles.tableHeadCell}>Pages</th>
            </tr>
          </thead>
          <tbody>
            {catalogues.map((catalogue, index) => (
              <tr
                key={catalogue.id}
                onDoubleClick={() => setModalState({ mode: "edit", catalogue })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  <span className={styles.tableCategoryName}>
                    <DiaryIcon className="h-3.5 w-3.5" />
                    {catalogue.catalogueName}
                    {!catalogue.isVisible && <span className={styles.inactiveBadge}>Hidden</span>}
                  </span>
                </td>
                <td className={styles.tableCell}>
                  {vendorsById.get(String(catalogue.catalogueVendorId)) ?? "—"}
                </td>
                <td className={styles.tableCell}>
                  {CATALOGUE_TYPE_LABELS[catalogue.catalogueType] ?? catalogue.catalogueType}
                </td>
                <td className={styles.tableCell}>
                  {catalogue.categoryIds
                    .map((id) => categoriesById.get(id))
                    .filter((name): name is string => Boolean(name))
                    .join(", ") || "—"}
                </td>
                <td className={styles.tableCell}>{catalogue.imagePaths.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading catalogues…</p>}
        {loadState === "error" && (
          <p role="alert" className={styles.formError}>
            Failed to load catalogues.
          </p>
        )}
        {loadState === "loaded" && catalogues.length === 0 && (
          <p className={styles.pageSubtext}>No catalogues yet.</p>
        )}
      </div>

      {modalState && (
        <CatalogueFormModal
          mode={modalState.mode}
          initialCatalogue={modalState.mode === "edit" ? modalState.catalogue : undefined}
          vendors={vendors}
          categoryOptions={categoryOptions}
          onClose={() => setModalState(null)}
          onImagesChangedWithoutSave={loadAll}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
