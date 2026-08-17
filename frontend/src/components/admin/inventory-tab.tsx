"use client";

// ---------------------------------------------------------------------------
// <InventoryTab> — "Inventory" tab on /admin/inventory
// ---------------------------------------------------------------------------
// Read-only current-stock view: one row per product actually in stock (from
// GET /admin/get_inventory — backend/app/api/routes/inventory.py, which
// omits products with 0 quantity), showing the product name/HSN already
// joined in server-side and the current quantity on hand. There's nothing to
// add/edit here — stock only moves as a side-effect of creating
// purchase/sales orders (see components/admin/purchase-order-form-modal.tsx
// and sales-order-form-modal.tsx), which is also what writes the ledger rows
// shown on the sibling <InventoryHistoryTab>.
//
// A quantity below 0 is possible for orders created before the sales-order
// stock check (backend/app/api/routes/sales_orders.py's
// _validate_sufficient_stock) existed, so negative rows are flagged rather
// than assumed impossible.
import { useEffect, useState } from "react";
import { fetchInventory, type InventoryItem } from "@/lib/inventory";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded";

export function InventoryTab() {
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

  const sortedItems = [...items].sort((a, b) => a.productName.localeCompare(b.productName));

  return (
    <>
      <p className={styles.pageSubtext}>Current stock on hand for every product, updated by purchases and sales.</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Product</th>
              <th className={styles.tableHeadCell}>HSN</th>
              <th className={styles.tableHeadCell}>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, index) => (
              <tr key={item.productId} className={styles.tableRow}>
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{item.productName}</td>
                <td className={styles.tableCell}>{item.hsnCode}</td>
                <td className={`${styles.tableCell} ${item.quantity < 0 ? styles.negativeQuantity : ""}`}>
                  {item.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading inventory…</p>}
        {loadState === "loaded" && sortedItems.length === 0 && (
          <p className={styles.pageSubtext}>No products yet.</p>
        )}
      </div>
    </>
  );
}
