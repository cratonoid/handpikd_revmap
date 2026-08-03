"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrdersTab> — "Purchase orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendors-page-client.tsx. Owns the purchase order
// table (fetched from GET /admin/get_purchase_order_details, see
// lib/purchase-orders.ts — not yet implemented on the backend) plus the
// vendor and product lists the "+ New purchase order" form needs to populate
// its vendor picker and per-line product picker (components/admin/
// purchase-order-form-modal.tsx).
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

type LoadState = "loading" | "loaded";

export function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalOpen, setModalOpen] = useState(false);

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
        // get_purchase_order_details / get_product_details aren't live on
        // the backend yet, so a failed fetch is the expected state for now.
        if (cancelled) return;
        setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(order: PurchaseOrder) {
    setOrders((prev) => [...prev, order]);
    setModalOpen(false);
  }

  const nextPurchaseOrderNo = orders.reduce((max, o) => Math.max(max, o.purchaseOrderNo), 0) + 1;

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <p className={styles.pageSubtext}>Raise and track purchase orders placed with vendors.</p>
        <Button type="button" variant="primary" onClick={() => setModalOpen(true)}>
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
              <tr key={order.id || `${order.purchaseOrderNo}-${index}`} className={styles.tableRow}>
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

      {modalOpen && (
        <PurchaseOrderFormModal
          vendors={vendorOptions}
          products={products}
          nextPurchaseOrderNo={nextPurchaseOrderNo}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
