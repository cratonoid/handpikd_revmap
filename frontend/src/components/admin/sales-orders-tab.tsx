"use client";

// ---------------------------------------------------------------------------
// <SalesOrdersTab> — "Sales orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Mirrors purchase-orders-tab.tsx, plus the Active/Deleted `view` toggle from
// vendors-page-client.tsx — GET /admin/get_sales_order_details returns every
// order (active and soft-deleted alike), and this tab splits them client-side
// since SalesOrders has an is_deleted flag (unlike PurchaseOrders). "+ New
// sales order" opens the popup in "add" mode; double-clicking an existing row
// opens it in "edit" mode, pre-filled with that row's data. Both modes save
// through the same popup (components/admin/sales-order-form-modal.tsx), which
// POSTs to create_new_sales_order / update_sales_order_details
// (backend/app/api/routes/sales_orders.py).
//
// get_customer_list is used (rather than the heavier, email-keyed
// get_customer_details) because it's the only endpoint exposing a numeric
// customer id — and it returns every customer, active and deleted, so the
// table can still resolve a name for orders placed against a since-deleted
// customer (see lib/customers.ts).
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { SalesOrderFormModal } from "@/components/admin/sales-order-form-modal";
import { fetchSalesOrders, type SalesOrder } from "@/lib/sales-orders";
import { fetchCustomerList, type CustomerOption } from "@/lib/customers";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchPurchaseOrderList, type PurchaseOrderOption } from "@/lib/purchase-orders";
import { fetchOrderStatusList, type OrderStatus } from "@/lib/order-status";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; order: SalesOrder } | null;
type LoadState = "loading" | "loaded";
type View = "active" | "deleted";

export function SalesOrdersTab() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatus[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [view, setView] = useState<View>("active");

  const customersById = new Map(customers.map((c) => [c.id, c]));
  const statusesById = new Map(orderStatuses.map((s) => [s.id, s]));
  const visibleOrders = orders.filter((o) => (view === "deleted" ? o.isDeleted : !o.isDeleted));

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchSalesOrders(),
      fetchCustomerList(),
      fetchProducts(),
      fetchPurchaseOrderList(),
      fetchOrderStatusList(),
    ])
      .then(([orderData, customerData, productData, purchaseOrderData, orderStatusData]) => {
        if (cancelled) return;
        setOrders(orderData);
        setCustomers(customerData);
        setProducts(productData);
        setPurchaseOrders(purchaseOrderData);
        setOrderStatuses(orderStatusData);
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
  // order, since create_new_sales_order/update_sales_order_details only
  // return {message} — no real id to key off of (same reasoning as
  // purchase-orders-tab.tsx's handleSaved).
  function handleSaved() {
    setModalState(null);
    fetchSalesOrders()
      .then(setOrders)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the save itself already succeeded.
      });
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <p className={styles.pageSubtext}>Raise and track sales orders placed by customers.</p>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + New sales order
        </Button>
      </div>

      <div className={styles.viewToggle} role="tablist" aria-label="Sales order status">
        <button
          type="button"
          role="tab"
          aria-selected={view === "active"}
          onClick={() => setView("active")}
          className={`${styles.viewToggleButton} ${view === "active" ? styles.viewToggleButtonActive : ""}`}
        >
          Active orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "deleted"}
          onClick={() => setView("deleted")}
          className={`${styles.viewToggleButton} ${view === "deleted" ? styles.viewToggleButtonActive : ""}`}
        >
          Deleted orders
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Order no.</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Before tax</th>
              <th className={styles.tableHeadCell}>Tax</th>
              <th className={styles.tableHeadCell}>After tax</th>
              <th className={styles.tableHeadCell}>Description</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order, index) => (
              <tr
                key={order.id || `${order.orderNo}-${index}`}
                onDoubleClick={() => setModalState({ mode: "edit", order })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{order.orderNo}</td>
                <td className={styles.tableCell}>{customersById.get(order.custId)?.name ?? "—"}</td>
                <td className={styles.tableCell}>{statusesById.get(order.orderStatusId)?.statusName ?? "—"}</td>
                <td className={styles.tableCell}>₹{order.totalAmountBeforeTax.toFixed(2)}</td>
                <td className={styles.tableCell}>₹{order.totalTaxAmount.toFixed(2)}</td>
                <td className={styles.tableCell}>₹{order.totalAmountAfterTax.toFixed(2)}</td>
                <td className={styles.tableCell}>{order.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading sales orders…</p>}
        {loadState === "loaded" && visibleOrders.length === 0 && (
          <p className={styles.pageSubtext}>No {view} sales orders.</p>
        )}
      </div>

      {modalState && (
        <SalesOrderFormModal
          mode={modalState.mode}
          initialOrder={modalState.mode === "edit" ? modalState.order : undefined}
          customers={customers}
          products={products}
          purchaseOrders={purchaseOrders}
          orderStatuses={orderStatuses}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
