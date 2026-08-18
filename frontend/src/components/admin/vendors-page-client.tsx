"use client";

// ---------------------------------------------------------------------------
// <VendorsPageClient> — the interactive half of /admin/vendors
// ---------------------------------------------------------------------------
// Mirrors components/admin/clients-page-client.tsx. Owns the vendor table
// (fetched from GET /admin/get_vendor_details, see lib/vendors.ts) and the
// add/edit popup (components/admin/vendor-form-modal.tsx). Clicking "+ Add
// new vendor" opens the popup in "add" mode; double-clicking an existing row
// opens it in "edit" mode, pre-filled with that row's data (double click,
// rather than clients' single click, so a stray click on the table doesn't
// accidentally open the edit/delete form). Both modes save through the same
// modal, which POSTs to add_vendor_details / update_vendor_details (not yet
// implemented on the backend).
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { VendorFormModal } from "@/components/admin/vendor-form-modal";
import { fetchVendors, VENDOR_TYPE_LABELS, type Vendor, type VendorType } from "@/lib/vendors";
import { stateNameForCode } from "@/lib/gst";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; vendor: Vendor } | null;
type LoadState = "loading" | "loaded";
type View = "active" | "deleted";
// "all" is the catch-all — it's also the only filter that shows vendors
// created before vendor types existed (their vendorType is ""), since those
// belong to neither type. See lib/vendors.ts.
type TypeFilter = "all" | VendorType;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(VENDOR_TYPE_LABELS) as VendorType[]).map((type) => ({
    value: type,
    label: VENDOR_TYPE_LABELS[type],
  })),
];

export function VendorsPageClient() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [view, setView] = useState<View>("active");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const visibleVendors = vendors.filter(
    (v) =>
      (view === "deleted" ? v.isDeleted : !v.isDeleted) && (typeFilter === "all" || v.vendorType === typeFilter),
  );

  useEffect(() => {
    let cancelled = false;

    fetchVendors()
      .then((data) => {
        if (cancelled) return;
        setVendors(data);
        setLoadState("loaded");
      })
      .catch(() => {
        // get_vendor_details isn't live on the backend yet, so a failed
        // fetch is the expected state for now — fall back to an empty
        // list rather than showing a scary error.
        if (cancelled) return;
        setVendors([]);
        setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(vendor: Vendor) {
    setVendors((prev) => {
      const index = prev.findIndex((v) => v.id === vendor.id);
      if (index === -1) {
        return [...prev, vendor];
      }
      const next = [...prev];
      next[index] = vendor;
      return next;
    });
    setModalState(null);
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Vendors</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new vendor
        </Button>
      </div>

      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Vendor type">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={typeFilter === filter.value}
              onClick={() => setTypeFilter(filter.value)}
              className={`${styles.viewToggleButton} ${typeFilter === filter.value ? styles.viewToggleButtonActive : ""}`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className={`${styles.viewToggle} ${styles.viewToggleEnd}`} role="tablist" aria-label="Vendor status">
          <button
            type="button"
            role="tab"
            aria-selected={view === "active"}
            onClick={() => setView("active")}
            className={`${styles.viewToggleButton} ${view === "active" ? styles.viewToggleButtonActive : ""}`}
          >
            Active vendors
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "deleted"}
            onClick={() => setView("deleted")}
            className={`${styles.viewToggleButton} ${view === "deleted" ? styles.viewToggleButtonActive : ""}`}
          >
            Deleted vendors
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>GST number</th>
              <th className={styles.tableHeadCell}>State</th>
              <th className={styles.tableHeadCell}>Address</th>
            </tr>
          </thead>
          <tbody>
            {visibleVendors.map((vendor, index) => (
              <tr
                key={vendor.id}
                onDoubleClick={() => setModalState({ mode: "edit", vendor })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{vendor.registeredName}</td>
                <td className={styles.tableCell}>
                  {vendor.vendorType ? VENDOR_TYPE_LABELS[vendor.vendorType] : "—"}
                </td>
                <td className={styles.tableCell}>{vendor.gst}</td>
                {/* Decides SGST + CGST vs IGST on purchases from this vendor. */}
                <td className={styles.tableCell}>
                  {vendor.stateName || stateNameForCode(vendor.gst.slice(0, 2)) || "—"}
                </td>
                <td className={styles.tableCell} title={vendor.address}>
                  <span className={styles.tableCellTruncate}>{vendor.address}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading vendors…</p>}
        {loadState === "loaded" && visibleVendors.length === 0 && (
          <p className={styles.pageSubtext}>No vendors available.</p>
        )}
      </div>

      {modalState && (
        <VendorFormModal
          mode={modalState.mode}
          initialVendor={modalState.mode === "edit" ? modalState.vendor : undefined}
          vendors={vendors}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
