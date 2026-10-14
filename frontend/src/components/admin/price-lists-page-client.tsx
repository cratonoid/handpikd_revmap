"use client";

// ---------------------------------------------------------------------------
// <PriceListsPageClient> — the interactive half of /admin/price-lists
// ---------------------------------------------------------------------------
// Mirrors catalogues-page-client.tsx. Owns the price list table (fetched from
// GET /admin/get_price_list_details, see lib/price-lists.ts) and the add/edit
// popup (price-list-form-modal.tsx): "+ Add price list" opens it in "add"
// mode, double-clicking a row opens it in "edit" mode. Each row's file
// button opens the vendor's original PDF in a new tab, or downloads it when
// it's an Excel workbook — price lists are private, so there is no public
// link to either, only the authenticated fetch.
//
// Vendor and catalogue names are resolved locally from the same option lists
// the form modal's pickers use. The search box filters client-side over the
// four text columns: name, vendor, linked catalogue and notes.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { PriceListFormModal } from "@/components/admin/price-list-form-modal";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { PriceListIcon } from "@/components/icons";
import { formatDate } from "@/lib/format-date";
import {
  fetchPriceListCatalogueOptions,
  fetchPriceLists,
  isExcelFileType,
  openPriceListFile,
  type PriceList,
  type PriceListCatalogueOption,
} from "@/lib/price-lists";
import { fetchVendorsList, type VendorOption } from "@/lib/vendors";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; priceList: PriceList } | null;
type LoadState = "loading" | "loaded" | "error";

export function PriceListsPageClient() {
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [catalogues, setCatalogues] = useState<PriceListCatalogueOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [search, setSearch] = useState("");
  const [viewError, setViewError] = useState<string | null>(null);

  function loadAll(): Promise<void> {
    return Promise.all([fetchPriceLists(), fetchVendorsList(), fetchPriceListCatalogueOptions()])
      .then(([priceListData, vendorData, catalogueData]) => {
        setPriceLists(priceListData);
        setVendors(vendorData);
        setCatalogues(catalogueData);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const vendorsById = new Map(vendors.map((v) => [v.id, v.name]));
  const cataloguesById = new Map(catalogues.map((c) => [c.id, c.catalogueName]));

  const visiblePriceLists = priceLists.filter((priceList) =>
    matchesSearch(search, [
      priceList.priceListName,
      vendorsById.get(priceList.vendorId),
      priceList.catalogueId !== null ? cataloguesById.get(priceList.catalogueId) : undefined,
      priceList.notes,
    ]),
  );

  function handleChanged() {
    void loadAll();
    setModalState(null);
  }

  async function handleView(priceList: PriceList) {
    setViewError(null);
    try {
      await openPriceListFile(priceList);
    } catch {
      setViewError("Couldn't open that file. Please try again.");
    }
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Price Lists</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add price list
        </Button>
      </div>

      <div className={styles.filterToggleRow}>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label="Search price lists"
          placeholder="Search price list, vendor or catalogue…"
        />
      </div>

      {viewError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {viewError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Price list</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Catalogue</th>
              <th className={styles.tableHeadCell}>Uploaded</th>
              <th className={styles.tableHeadCell}>File</th>
            </tr>
          </thead>
          <tbody>
            {visiblePriceLists.map((priceList, index) => (
              <tr
                key={priceList.id}
                onDoubleClick={() => setModalState({ mode: "edit", priceList })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  <span className={styles.tableCategoryName}>
                    <PriceListIcon className="h-3.5 w-3.5" />
                    {priceList.priceListName}
                  </span>
                </td>
                <td className={styles.tableCell}>{vendorsById.get(priceList.vendorId) ?? "—"}</td>
                <td className={styles.tableCell}>
                  {priceList.catalogueId !== null ? (cataloguesById.get(priceList.catalogueId) ?? "—") : "—"}
                </td>
                <td className={styles.tableCell}>{formatDate(priceList.uploadedAt)}</td>
                <td className={styles.tableCell}>
                  <button
                    type="button"
                    className={styles.tableActionButton}
                    onClick={() => void handleView(priceList)}
                    // Double-clicking the button shouldn't also open the edit popup.
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {isExcelFileType(priceList.fileType) ? "Download Excel" : "View PDF"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading price lists…</p>}
        {loadState === "error" && (
          <p role="alert" className={styles.formError}>
            Failed to load price lists.
          </p>
        )}
        {loadState === "loaded" && visiblePriceLists.length === 0 && (
          <p className={styles.pageSubtext}>
            {search.trim() !== "" ? "No price lists match your search." : "No price lists yet."}
          </p>
        )}
      </div>

      {modalState && (
        <PriceListFormModal
          mode={modalState.mode}
          initialPriceList={modalState.mode === "edit" ? modalState.priceList : undefined}
          vendors={vendors}
          catalogues={catalogues}
          onClose={() => setModalState(null)}
          onSaved={handleChanged}
          onDeleted={handleChanged}
        />
      )}
    </>
  );
}
