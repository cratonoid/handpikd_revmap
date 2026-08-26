"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrdersTab> — "Purchase orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Mirrors components/admin/vendors-page-client.tsx, including its add/edit
// split: "+ New purchase order" starts the add flow; double-clicking an
// existing row opens the popup in "edit" mode, pre-filled with that row's
// data. Both modes save through the same popup (components/admin/
// purchase-order-form-modal.tsx), which POSTs to create_new_purchase_order /
// update_purchase_order_details (backend/app/api/routes/orders.py).
//
// Adding is a three-step flow rather than one popup, since a purchase order
// can be started from the vendor's own invoice:
//   "choose" -> purchase-order-source-modal.tsx asks which way
//   "upload" -> purchase-invoice-upload-modal.tsx reads the vendor's PDF and
//               hands back the values it found
//   "add"    -> the ordinary form, empty or pre-filled with those values for
//               review
// Creating an order also raises its purchase invoice server-side, so both
// paths show up on /admin/invoices without anything being added there.
//
// Two separate vendor fetches: the full get_vendor_details list (`vendors`)
// resolves the table's vendor column, including for orders whose vendor has
// since been soft-deleted; the lightweight get_vendors_list
// (`vendorOptions`) feeds the popup's picker, which should only offer active
// vendors.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { PurchaseInvoiceUploadModal } from "@/components/admin/purchase-invoice-upload-modal";
import { PurchaseOrderFormModal } from "@/components/admin/purchase-order-form-modal";
import { PurchaseOrderSourceModal } from "@/components/admin/purchase-order-source-modal";
import {
  fetchPurchaseOrders,
  type ParsedPurchaseInvoice,
  type PurchaseOrder,
} from "@/lib/purchase-orders";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchProfileDetails } from "@/lib/profile-details";
import { resolveStateCode } from "@/lib/gst";
import styles from "@/styles/dashboard.module.css";

type ModalState =
  | { mode: "choose" }
  | { mode: "upload" }
  // prefill/pdfFile are set only when the add form was reached by uploading
  // an invoice; they're absent for an order being keyed in from scratch.
  | { mode: "add"; prefill?: ParsedPurchaseInvoice; pdfFile?: File }
  | { mode: "edit"; order: PurchaseOrder }
  | null;
type LoadState = "loading" | "loaded";

export function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Our own GST state. Fetched here rather than in the form modal so it
  // rides along with the tab's existing load instead of costing a
  // request every time the popup opens. The purchase order form compares
  // it against the chosen vendor's state to default SGST + CGST vs IGST.
  const [ownStateCode, setOwnStateCode] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchPurchaseOrders(),
      fetchVendors(),
      fetchVendorsList(),
      fetchProducts(),
      fetchProfileDetails(),
    ])
      .then(([orderData, vendorData, vendorOptionData, productData, profile]) => {
        if (cancelled) return;
        setOrders(orderData);
        setVendors(vendorData);
        setVendorOptions(vendorOptionData);
        setProducts(productData);
        setOwnStateCode(resolveStateCode(profile.state_code, profile.gstin));
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
      {/* Matches the sales tab next door: no subtitle restating the page
          subtext, action button right-aligned above the table. */}
      <div className={styles.filterToggleRow}>
        <Button
          type="button"
          variant="primary"
          className={styles.filterToggleRowAction}
          onClick={() => setModalState({ mode: "choose" })}
        >
          + New purchase order
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>PO no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>Vendor</th>
              <th className={styles.tableHeadCell}>Before tax</th>
              <th className={styles.tableHeadCell}>After tax</th>
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
                <td className={styles.tableCell}>{new Date(order.date).toLocaleDateString()}</td>
                <td className={styles.tableCell}>{vendorsById.get(order.vendorId)?.registeredName ?? "—"}</td>
                <td className={styles.tableCell}>₹{order.totalAmountBeforeTax.toFixed(2)}</td>
                <td className={styles.tableCell}>₹{order.totalAmountAfterTax.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading purchase orders…</p>}
        {loadState === "loaded" && orders.length === 0 && (
          <p className={styles.pageSubtext}>No purchase orders yet.</p>
        )}
      </div>

      {modalState?.mode === "choose" && (
        <PurchaseOrderSourceModal
          onChoose={(source) => setModalState(source === "upload" ? { mode: "upload" } : { mode: "add" })}
          onClose={() => setModalState(null)}
        />
      )}

      {modalState?.mode === "upload" && (
        <PurchaseInvoiceUploadModal
          onParsed={(prefill, pdfFile) => setModalState({ mode: "add", prefill, pdfFile })}
          onFillManually={() => setModalState({ mode: "add" })}
          onClose={() => setModalState(null)}
        />
      )}

      {(modalState?.mode === "add" || modalState?.mode === "edit") && (
        <PurchaseOrderFormModal
          mode={modalState.mode}
          initialOrder={modalState.mode === "edit" ? modalState.order : undefined}
          prefill={modalState.mode === "add" ? modalState.prefill : undefined}
          initialPdfFile={modalState.mode === "add" ? modalState.pdfFile : undefined}
          vendors={vendorOptions}
          products={products}
          // A product created from an unresolved line of an uploaded invoice
          // (see purchase-order-form-modal.tsx). Appended rather than
          // re-fetching every product, so the line that needed it can select
          // it immediately.
          onProductCreated={(product) => setProducts((prev) => [...prev, product])}
          ownStateCode={ownStateCode}
          nextPurchaseOrderNo={nextPurchaseOrderNo}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
