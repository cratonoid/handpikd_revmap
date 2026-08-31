"use client";

// ---------------------------------------------------------------------------
// <InventoryTab> — "Inventory" tab on /admin/inventory
// ---------------------------------------------------------------------------
// Read-only current-stock view: one row per product actually in stock (from
// GET /admin/get_inventory — backend/app/api/routes/inventory.py, which
// omits products with 0 quantity), showing the product name/HSN already
// joined in server-side and the current quantity on hand. There's nothing to
// add/edit here — stock only moves as a side-effect of creating
// purchase/sales orders (see components/admin/purchase-order-form-modal.tsx,
// unbilled-purchase-order-form-modal.tsx and sales-order-form-modal.tsx),
// which is also what writes the ledger rows shown on the sibling
// <InventoryHistoryTab>.
//
// A Billed/Unbilled pill splits the list, matching the same split on the
// Purchase orders tab. It is a filter over one collection rather than two
// endpoints: unbilled stock lives in the same #inventory rows and moves
// through the same helpers, and the only thing telling the two apart is
// is_unbilled on the product (which is also why every unbilled row's HSN
// column is empty). See backend/app/models/product_details.py.
//
// A quantity below 0 is possible for orders created before the sales-order
// stock check (backend/app/api/routes/sales_orders.py's
// _validate_sufficient_stock) existed, so negative rows are flagged rather
// than assumed impossible.
import { useEffect, useState } from "react";
import { fetchInventory, type InventoryItem } from "@/lib/inventory";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded";
type View = "billed" | "unbilled";

export function InventoryTab() {
  const [view, setView] = useState<View>("billed");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    fetchInventory()
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setLoadState("loaded");
      })
      .catch(() => {
        // A failed fetch (e.g. the backend being unreachable) falls back to
        // an empty list rather than showing a scary error.
        if (cancelled) return;
        setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isUnbilled = view === "unbilled";
  const sortedItems = items
    .filter((item) => item.isUnbilled === isUnbilled)
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return (
    <>
      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Inventory billing">
          <button
            type="button"
            role="tab"
            aria-selected={!isUnbilled}
            onClick={() => setView("billed")}
            className={`${styles.viewToggleButton} ${!isUnbilled ? styles.viewToggleButtonActive : ""}`}
          >
            Billed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isUnbilled}
            onClick={() => setView("unbilled")}
            className={`${styles.viewToggleButton} ${isUnbilled ? styles.viewToggleButtonActive : ""}`}
          >
            Unbilled
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Product</th>
              {/* Dropped on the unbilled side rather than shown empty: an
                  unbilled product has no HSN code by definition, so the
                  column would be a row of blanks. */}
              {!isUnbilled && <th className={styles.tableHeadCell}>HSN</th>}
              <th className={styles.tableHeadCell}>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, index) => (
              <tr key={item.productId} className={styles.tableRow}>
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{item.productName}</td>
                {!isUnbilled && <td className={styles.tableCell}>{item.hsnCode}</td>}
                <td className={`${styles.tableCell} ${item.quantity < 0 ? styles.negativeQuantity : ""}`}>
                  {item.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading inventory…</p>}
        {loadState === "loaded" && sortedItems.length === 0 && (
          <p className={styles.pageSubtext}>
            {isUnbilled ? "No unbilled stock yet." : "No products yet."}
          </p>
        )}
      </div>
    </>
  );
}
