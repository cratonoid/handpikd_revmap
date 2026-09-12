"use client";

// ---------------------------------------------------------------------------
// <SalesOrdersTab> — "Sales orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Mirrors purchase-orders-tab.tsx. GET /admin/get_sales_order_details only
// ever returns active orders — soft-deleted ones (SalesOrders.is_deleted,
// unlike PurchaseOrders) are excluded server-side so they can't be viewed.
// "+ New sales order" opens the popup in "add" mode; double-clicking an
// existing row opens it in "edit" mode, pre-filled with that row's data.
// Both modes save through the same popup
// (components/admin/sales-order-form-modal.tsx), which POSTs to
// create_new_sales_order / update_sales_order_details
// (backend/app/api/routes/sales_orders.py).
//
// The status tabs (All + one per OrderStatusMaster row) are built from
// `orderStatuses` rather than a hardcoded list, so they always match
// whatever statuses are seeded in backend/app/core/db.py. The same list
// fills the Status column's per-row dropdown, which moves one order between
// statuses without opening the form — see handleStatusChange.
//
// The "Add details" link per row opens the costing sheet at
// /admin/orders/sales/[id]/details (components/admin/
// sales-order-costing-page-client.tsx) — the per-product purchase rates,
// printing/delivery/misc costs, discount and profit behind the order. It's a
// page rather than another popup because it carries far more figures than
// the order form does. Its own click is stopped from bubbling so it doesn't
// also count towards the row's double-click-to-edit.
//
// get_customer_list is used (rather than the heavier, email-keyed
// get_customer_details) because it's the only endpoint exposing a numeric
// customer id — and it returns every customer, active and deleted, so the
// table can still resolve a name for orders placed against a since-deleted
// customer (see lib/customers.ts).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { SalesOrderFormModal } from "@/components/admin/sales-order-form-modal";
import { StatusSelect } from "@/components/admin/status-select";
import { fetchSalesOrders, updateSalesOrderStatus, type SalesOrder } from "@/lib/sales-orders";
import { fetchCustomerList, type CustomerOption } from "@/lib/customers";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchPurchaseOrderList, type PurchaseOrderOption } from "@/lib/purchase-orders";
import {
  fetchUnbilledPurchaseOrderList,
  type UnbilledPurchaseOrderOption,
} from "@/lib/unbilled-purchase-orders";
import { fetchOrderStatusList, type OrderStatus } from "@/lib/order-status";
import { byNewestFirst } from "@/lib/row-order";
import styles from "@/styles/dashboard.module.css";
import { formatDate } from "@/lib/format-date";

type ModalState = { mode: "add" } | { mode: "edit"; order: SalesOrder } | null;
type LoadState = "loading" | "loaded";
type StatusFilter = "all" | number;

// Status name (lowercased) -> the color modifier for its Status cell. Keyed by
// name rather than OrderStatusMaster id so the colors survive a reseed that
// renumbers the rows. Anything not listed here — a status added to
// _ORDER_STATUS_SEED in backend/app/core/db.py without a color picked for it —
// falls through to plain .tableCell ink rather than borrowing another
// status's color.
const STATUS_COLOR_CLASSES: Record<string, string> = {
  new: styles.statusNew,
  processing: styles.statusProcessing,
  delivered: styles.statusDelivered,
  completed: styles.statusCompleted,
};

function statusCellClassName(statusName: string | undefined) {
  const colorClass = statusName ? STATUS_COLOR_CLASSES[statusName.toLowerCase()] : undefined;
  return `${styles.tableCell} ${styles.statusText} ${colorClass ?? ""}`;
}

export function SalesOrdersTab() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  // Its own list, not folded into the one above: billed and unbilled purchase
  // orders live in different collections with overlapping ids, so the form
  // submits them as two separate arrays.
  const [unbilledPurchaseOrders, setUnbilledPurchaseOrders] = useState<UnbilledPurchaseOrderOption[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatus[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // The order whose status dropdown is mid-save, and the reason the last
  // attempt failed. Only one row can be saving at a time — the dropdown
  // disables itself while its own request is in flight.
  const [statusSavingId, setStatusSavingId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const customersById = new Map(customers.map((c) => [c.id, c]));
  const statusesById = new Map(orderStatuses.map((s) => [s.id, s]));
  const sortedStatuses = [...orderStatuses].sort((a, b) => a.id - b.id);
  // The same seeded list the filter pills are built from, in the shape the
  // row dropdowns take.
  const statusOptions = sortedStatuses.map((orderStatus) => ({
    value: orderStatus.id,
    label: orderStatus.statusName,
  }));
  const visibleOrders = (
    statusFilter === "all" ? orders : orders.filter((order) => order.orderStatusId === statusFilter)
  )
    .slice()
    .sort(byNewestFirst);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchSalesOrders(),
      fetchCustomerList(),
      fetchProducts(),
      fetchPurchaseOrderList(),
      fetchUnbilledPurchaseOrderList(),
      fetchOrderStatusList(),
    ])
      .then(
        ([
          orderData,
          customerData,
          productData,
          purchaseOrderData,
          unbilledPurchaseOrderData,
          orderStatusData,
        ]) => {
          if (cancelled) return;
          setOrders(orderData);
          setCustomers(customerData);
          setProducts(productData);
          setPurchaseOrders(purchaseOrderData);
          setUnbilledPurchaseOrders(unbilledPurchaseOrderData);
          setOrderStatuses(orderStatusData);
          setLoadState("loaded");
        },
      )
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

  // The Status column's dropdown. Applied optimistically — the cell (and,
  // under an active status filter, whether the row is listed at all) follows
  // the new status straight away — then rolled back if the backend refuses.
  // It can refuse: moving an order into "Delivered"/"Completed" takes its
  // quantities out of stock, and there may not be enough (see
  // update_sales_order_status in backend/app/api/routes/sales_orders.py).
  //
  // Unlike handleSaved this doesn't re-fetch: one field changed, and its new
  // value is exactly what was just sent.
  async function handleStatusChange(order: SalesOrder, nextStatusId: number) {
    if (nextStatusId === order.orderStatusId) return;

    const previousStatusId = order.orderStatusId;
    const applyStatus = (statusId: number) =>
      setOrders((current) =>
        current.map((row) => (row.id === order.id ? { ...row, orderStatusId: statusId } : row)),
      );

    setStatusError(null);
    setStatusSavingId(order.id);
    applyStatus(nextStatusId);

    const error = await updateSalesOrderStatus(order.id, nextStatusId);

    setStatusSavingId(null);
    if (error) {
      applyStatus(previousStatusId);
      setStatusError(error);
    }
  }

  return (
    <>
      {/* Status pills and the "new order" button share one row. They used to be
          two stacked rows, with a third above them for a subtitle that only
          restated the page subtext in orders-page-client.tsx — three rows of
          chrome that left barely two orders visible under it. */}
      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Sales order status">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            className={`${styles.viewToggleButton} ${statusFilter === "all" ? styles.viewToggleButtonActive : ""}`}
          >
            All
          </button>
          {sortedStatuses.map((orderStatus) => (
            <button
              key={orderStatus.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === orderStatus.id}
              onClick={() => setStatusFilter(orderStatus.id)}
              className={`${styles.viewToggleButton} ${statusFilter === orderStatus.id ? styles.viewToggleButtonActive : ""}`}
            >
              {orderStatus.statusName}
            </button>
          ))}
        </div>

        <Button
          type="button"
          variant="primary"
          className={styles.filterToggleRowAction}
          onClick={() => setModalState({ mode: "add" })}
        >
          + New sales order
        </Button>
      </div>

      {statusError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {statusError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Order no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Discount</th>
              <th className={styles.tableHeadCell}>Before tax</th>
              <th className={styles.tableHeadCell}>After tax</th>
              <th className={styles.tableHeadCell}>Description</th>
              <th className={styles.tableHeadCell}>Details</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order, index) => (
              <tr
                key={order.id || `${order.orderNo}-${index}`}
                onDoubleClick={() => setModalState({ mode: "edit", order })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{visibleOrders.length - index}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  {order.orderNo}
                  {order.poUpdatedFlag && <span className={styles.inactiveBadge}>PO updated</span>}
                </td>
                <td className={styles.tableCell}>{formatDate(order.date)}</td>
                <td className={styles.tableCell}>{customersById.get(order.custId)?.name ?? "—"}</td>
                <td className={statusCellClassName(statusesById.get(order.orderStatusId)?.statusName)}>
                  <StatusSelect
                    value={order.orderStatusId}
                    options={statusOptions}
                    label={`Status for order ${order.orderNo}`}
                    disabled={statusSavingId === order.id}
                    onChange={(nextStatusId) => void handleStatusChange(order, nextStatusId)}
                  />
                </td>
                {/* Already deducted from the two totals beside it — shown
                    so the figures can be read back against the order form. */}
                <td className={styles.tableCell}>
                  {order.overallDiscount ? `−₹${order.overallDiscount.toFixed(2)}` : "—"}
                </td>
                <td className={styles.tableCell}>₹{order.totalAmountBeforeTax.toFixed(2)}</td>
                <td className={styles.tableCell}>₹{order.totalAmountAfterTax.toFixed(2)}</td>
                <td className={styles.tableCell}>{order.description}</td>
                <td className={styles.tableCell}>
                  <Link
                    href={`/admin/orders/sales/${order.id}/details`}
                    onClick={(event) => event.stopPropagation()}
                    className={styles.tableActionButton}
                  >
                    Add details
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading sales orders…</p>}
        {loadState === "loaded" && visibleOrders.length === 0 && (
          <p className={styles.pageSubtext}>
            No {statusFilter === "all" ? "" : `${statusesById.get(statusFilter)?.statusName.toLowerCase()} `}sales
            orders.
          </p>
        )}
      </div>

      {modalState && (
        <SalesOrderFormModal
          mode={modalState.mode}
          initialOrder={modalState.mode === "edit" ? modalState.order : undefined}
          customers={customers}
          products={products}
          purchaseOrders={purchaseOrders}
          unbilledPurchaseOrders={unbilledPurchaseOrders}
          orderStatuses={orderStatuses}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
