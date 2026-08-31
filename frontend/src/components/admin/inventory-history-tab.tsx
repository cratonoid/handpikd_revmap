"use client";

// ---------------------------------------------------------------------------
// <InventoryHistoryTab> — "Inventory history" tab on /admin/inventory
// ---------------------------------------------------------------------------
// Read-only ledger view of GET /admin/get_inventory_history
// (backend/app/api/routes/inventory.py), one row per purchase/sale line
// item (see app/services/inventory.py). The table itself only shows enough
// to identify an entry — product, type, date — resolving the raw product_id
// FK against fetchProducts() the same way sales-orders-tab.tsx resolves
// customer names. Double-clicking a row opens <InventoryHistoryDetailModal>
// with the rest (reference no., HSN, quantity), the reference resolved from
// purchase_order_id/unbilled_purchase_order_id/sales_order_id against
// fetchPurchaseOrderList()/fetchUnbilledPurchaseOrderList()/
// fetchSalesOrders() — three lists rather than two because billed and
// unbilled purchase orders live in different collections whose ids overlap,
// so a row's transactionType is what says which one to look in.
import { useEffect, useState } from "react";
import { InventoryHistoryDetailModal } from "@/components/admin/inventory-history-detail-modal";
import { fetchInventoryHistory, type InventoryHistoryEntry } from "@/lib/inventory";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchPurchaseOrderList, type PurchaseOrderOption } from "@/lib/purchase-orders";
import { fetchSalesOrders, type SalesOrder } from "@/lib/sales-orders";
import {
  fetchUnbilledPurchaseOrderList,
  type UnbilledPurchaseOrderOption,
} from "@/lib/unbilled-purchase-orders";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded";

export function InventoryHistoryTab() {
  const [history, setHistory] = useState<InventoryHistoryEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [unbilledOrders, setUnbilledOrders] = useState<UnbilledPurchaseOrderOption[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedEntry, setSelectedEntry] = useState<InventoryHistoryEntry | null>(null);

  const productsById = new Map(products.map((p) => [p.id, p]));
  const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const unbilledOrdersById = new Map(unbilledOrders.map((po) => [po.id, po]));
  const salesOrdersById = new Map(salesOrders.map((so) => [so.id, so]));

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchInventoryHistory(),
      fetchProducts(),
      fetchPurchaseOrderList(),
      fetchUnbilledPurchaseOrderList(),
      fetchSalesOrders(),
    ])
      .then(([historyData, productData, purchaseOrderData, unbilledOrderData, salesOrderData]) => {
        if (cancelled) return;
        setHistory(historyData);
        setProducts(productData);
        setPurchaseOrders(purchaseOrderData);
        setUnbilledOrders(unbilledOrderData);
        setSalesOrders(salesOrderData);
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

  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  function referenceFor(entry: InventoryHistoryEntry): string {
    if (entry.transactionType === "purchase") {
      return entry.purchaseOrderId !== null
        ? (purchaseOrdersById.get(entry.purchaseOrderId)?.purchaseOrderNo ?? `#${entry.purchaseOrderId}`)
        : "—";
    }
    if (entry.transactionType === "unbilled_purchase") {
      return entry.unbilledPurchaseOrderId !== null
        ? (unbilledOrdersById.get(entry.unbilledPurchaseOrderId)?.purchaseOrderNo ??
            `#${entry.unbilledPurchaseOrderId}`)
        : "—";
    }
    return entry.salesOrderId !== null ? String(salesOrdersById.get(entry.salesOrderId)?.orderNo ?? `#${entry.salesOrderId}`) : "—";
  }

  // Spelt out rather than left as "Purchase" for both, since the whole point
  // of the unbilled row is that no bill sits behind that stock.
  function typeLabelFor(entry: InventoryHistoryEntry): string {
    if (entry.transactionType === "purchase") return "Purchase";
    if (entry.transactionType === "unbilled_purchase") return "Purchase (unbilled)";
    return "Sales";
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Product</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Date</th>
            </tr>
          </thead>
          <tbody>
            {sortedHistory.map((entry, index) => (
              <tr key={entry.id} onDoubleClick={() => setSelectedEntry(entry)} className={styles.tableRow}>
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  {productsById.get(entry.productId)?.productName ?? "—"}
                </td>
                <td className={styles.tableCell}>{typeLabelFor(entry)}</td>
                <td className={styles.tableCell}>{new Date(entry.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading inventory history…</p>}
        {loadState === "loaded" && sortedHistory.length === 0 && (
          <p className={styles.pageSubtext}>No inventory transactions yet.</p>
        )}
      </div>

      {selectedEntry && (
        <InventoryHistoryDetailModal
          entry={selectedEntry}
          productName={productsById.get(selectedEntry.productId)?.productName ?? "—"}
          // An unbilled product has no HSN code at all, so the modal shows
          // an em dash rather than an empty field.
          hsnCode={productsById.get(selectedEntry.productId)?.hsnCode || "—"}
          reference={referenceFor(selectedEntry)}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </>
  );
}
