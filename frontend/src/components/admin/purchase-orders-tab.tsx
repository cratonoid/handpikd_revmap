"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrdersTab> — "Purchase orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendors-page-client.tsx, including its add/edit
// split: "+ New purchase order" opens the popup in "add" mode; double-clicking
// an existing row opens it in "edit" mode, pre-filled with that row's data.
// Both modes save through the same popup (components/admin/
// purchase-order-form-modal.tsx), which POSTs to create_new_purchase_order /
// update_purchase_order_details (backend/app/api/routes/orders.py).
//
// Two separate vendor fetches: the full get_vendor_details list (`vendors`)
// resolves the table's vendor column, including for orders whose vendor has
// since been soft-deleted; the lightweight get_vendors_list
// (`vendorOptions`) feeds the popup's picker, which should only offer active
// vendors.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { PurchaseOrderFormModal } from "@/components/admin/purchase-order-form-modal";
import { fetchPurchaseOrders, type PurchaseOrder } from "@/lib/purchase-orders";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import { fetchProducts, type Product } from "@/lib/products";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; order: PurchaseOrder } | null;
type LoadState = "loading" | "loaded";

export function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchPurchaseOrders(), fetchVendors(), fetchVendorsList(), fetchProducts()])
      .then(([orderData, vendorData, vendorOptionData, productData]) => {
        if (cancelled) return;
        setOrders(orderData);
        setVendors(vendorData);
        setVendorOptions(vendorOptionData);
        setProducts(productData);
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

  // Re-fetches the full list instead of upserting a client-constructed
  // order, since create_new_purchase_order only returns {message} — no real
  // id to key off of. Without this, a freshly-created order would sit in
  // local state with a placeholder id: 0, and editing it before a page
  // refresh would 404 against the real backend (no order actually has id 0).
  function handleSaved() {
    setModalState(null);
    fetchPurchaseOrders()
      .then(setOrders)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the save itself already succeeded.
      });
  }

  // purchase_order_no is free-form text now, so only fold in the
  // numeric-looking ones for the suggested next value — the admin can still
  // freely overwrite it with anything.
  const nextPurchaseOrderNo = String(
    orders.reduce((max, o) => {
      const numeric = Number(o.purchaseOrderNo);
      return Number.isFinite(numeric) && o.purchaseOrderNo.trim() !== "" ? Math.max(max, numeric) : max;
    }, 0) + 1,
  );

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <p className={styles.pageSubtext}>Raise and track purchase orders placed with vendors.</p>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + New purchase order
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>PO no.</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Before tax</th>
              <th className={styles.tableHeadCell}>After tax</th>
              <th className={styles.tableHeadCell}>Description</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, index) => (
              <tr
                key={order.id || `${order.purchaseOrderNo}-${index}`}
                onDoubleClick={() => setModalState({ mode: "edit", order })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{order.purchaseOrderNo}</td>
                <td className={styles.tableCell}>{vendorsById.get(order.vendorId)?.registeredName ?? "—"}</td>
                <td className={styles.tableCell}>₹{order.totalAmountBeforeTax.toFixed(2)}</td>
                <td className={styles.tableCell}>₹{order.totalAmountAfterTax.toFixed(2)}</td>
                <td className={styles.tableCell}>{order.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading purchase orders…</p>}
        {loadState === "loaded" && orders.length === 0 && (
          <p className={styles.pageSubtext}>No purchase orders yet.</p>
        )}
      </div>

      {modalState && (
        <PurchaseOrderFormModal
          mode={modalState.mode}
          initialOrder={modalState.mode === "edit" ? modalState.order : undefined}
          vendors={vendorOptions}
          products={products}
          nextPurchaseOrderNo={nextPurchaseOrderNo}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
