"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrdersTab> — "Purchase orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Two views behind one tab, Material and Printing, on the same .viewToggle
// pattern the Sales invoices tab uses for Standard/Proforma. They are two
// genuinely different documents, not a filter over one list:
//   - Material  -> #purchase_orders. Line items are PRODUCTS, and saving one
//                  moves stock (backend/app/api/routes/orders.py).
//   - Printing  -> #printing_purchase_orders. Line items are SERVICES the
//                  vendor described, and nothing about them touches products
//                  or inventory (backend/app/api/routes/printing_orders.py).
// Which one a vendor belongs to is VendorDetails.vendor_type, so each view's
// vendor picker offers only its own kind and the backend rejects the other.
//
// Adding is a three-step flow on both sides, since either can be started
// from the vendor's own invoice:
//   "choose" -> purchase-order-source-modal.tsx asks which way
//   "upload" -> the matching upload modal reads the vendor's PDF and hands
//               back the values it found
//   "add"    -> the matching form, empty or pre-filled for review
// Creating an order also raises its purchase invoice server-side, so both
// paths show up on /admin/invoices without anything being added there.
//
// Two separate vendor fetches: the full get_vendor_details list (`vendors`)
// resolves each table's vendor column, including for orders whose vendor has
// since been soft-deleted; the lightweight get_vendors_list
// (`vendorOptions`) feeds the popups' pickers, which should only offer
// active vendors.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { PurchaseInvoiceUploadModal } from "@/components/admin/purchase-invoice-upload-modal";
import { PurchaseOrderFormModal } from "@/components/admin/purchase-order-form-modal";
import { PurchaseOrderSourceModal } from "@/components/admin/purchase-order-source-modal";
import { PrintingPurchaseInvoiceUploadModal } from "@/components/admin/printing-purchase-invoice-upload-modal";
import { PrintingPurchaseOrderFormModal } from "@/components/admin/printing-purchase-order-form-modal";
import {
  fetchPurchaseOrders,
  type ParsedPurchaseInvoice,
  type PurchaseOrder,
} from "@/lib/purchase-orders";
import {
  fetchPrintingPurchaseOrders,
  type ParsedPrintingPurchaseInvoice,
  type PrintingPurchaseOrder,
} from "@/lib/printing-purchase-orders";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchProfileDetails } from "@/lib/profile-details";
import { resolveStateCode } from "@/lib/gst";
import styles from "@/styles/dashboard.module.css";

type View = "material" | "printing";

type ModalState =
  | { mode: "choose" }
  | { mode: "upload" }
  // prefill/pdfFile are set only when the add form was reached by uploading
  // an invoice; they're absent for an order being keyed in from scratch.
  | { mode: "add"; prefill?: ParsedPurchaseInvoice; pdfFile?: File }
  | { mode: "edit"; order: PurchaseOrder }
  | { mode: "printingChoose" }
  | { mode: "printingUpload" }
  | { mode: "printingAdd"; prefill?: ParsedPrintingPurchaseInvoice; pdfFile?: File }
  | { mode: "printingEdit"; order: PrintingPurchaseOrder }
  | null;
type LoadState = "loading" | "loaded";

// The suggested next order number for whichever list it's given. Both
// numbers are free-form text, so only the numeric-looking ones are folded in
// — the admin can still freely overwrite it with anything, and an uploaded
// invoice replaces it with the vendor's own number.
//
// The two series are independent, as the collections are: a material and a
// printing order may legitimately carry the same number.
// Row order for both tables: oldest first, so the list reads as the
// purchasing history in the order it actually happened.
//
// Sorted for display only — the fetched arrays keep whatever order the
// backend sent, and S.No is a row counter rather than an identifier, so it
// renumbers with the sort instead of following a row around.
//
// The id tiebreaker matters because the date field is entered by hand and
// two orders keyed in the same minute compare equal. JS sort is stable, so
// without it those two would fall back to the backend's iteration order,
// which is not something to depend on.
function byDateThenId(
  a: { date: string; id: number },
  b: { date: string; id: number },
): number {
  return new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id;
}

function nextOrderNo(numbers: string[]): string {
  return String(
    numbers.reduce((max, value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && value.trim() !== "" ? Math.max(max, numeric) : max;
    }, 0) + 1,
  );
}

export function PurchaseOrdersTab() {
  const [view, setView] = useState<View>("material");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [printingOrders, setPrintingOrders] = useState<PrintingPurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Our own GST state. Fetched here rather than in the form modals so it
  // rides along with the tab's existing load instead of costing a request
  // every time a popup opens. Both order forms compare it against the chosen
  // vendor's state to default SGST + CGST vs IGST.
  const [ownStateCode, setOwnStateCode] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);

  const vendorsById = new Map(vendors.map((v) => [v.id, v]));
  const sortedOrders = [...orders].sort(byDateThenId);
  const sortedPrintingOrders = [...printingOrders].sort(byDateThenId);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchPurchaseOrders(),
      fetchPrintingPurchaseOrders(),
      fetchVendors(),
      fetchVendorsList(),
      fetchProducts(),
      fetchProfileDetails(),
    ])
      .then(([orderData, printingOrderData, vendorData, vendorOptionData, productData, profile]) => {
        if (cancelled) return;
        setOrders(orderData);
        setPrintingOrders(printingOrderData);
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
  // order, since the create endpoints return no order of their own — without
  // this, a freshly-created order would sit in local state with a
  // placeholder id and editing it before a page refresh would 404.
  function handleSaved() {
    setModalState(null);
    fetchPurchaseOrders()
      .then(setOrders)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the save itself already succeeded.
      });
  }

  function handlePrintingSaved() {
    setModalState(null);
    fetchPrintingPurchaseOrders()
      .then(setPrintingOrders)
      .catch(() => {});
  }

  const isPrinting = view === "printing";

  return (
    <>
      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Purchase order type">
          <button
            type="button"
            role="tab"
            aria-selected={!isPrinting}
            onClick={() => setView("material")}
            className={`${styles.viewToggleButton} ${!isPrinting ? styles.viewToggleButtonActive : ""}`}
          >
            Material
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isPrinting}
            onClick={() => setView("printing")}
            className={`${styles.viewToggleButton} ${isPrinting ? styles.viewToggleButtonActive : ""}`}
          >
            Printing
          </button>
        </div>

        <Button
          type="button"
          variant="primary"
          className={styles.filterToggleRowAction}
          onClick={() => setModalState({ mode: isPrinting ? "printingChoose" : "choose" })}
        >
          {isPrinting ? "+ New printing purchase order" : "+ New purchase order"}
        </Button>
      </div>

      {!isPrinting && (
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
              {sortedOrders.map((order, index) => (
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
      )}

      {isPrinting && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>PO no.</th>
                <th className={styles.tableHeadCell}>Date</th>
                <th className={styles.tableHeadCell}>Vendor</th>
                {/* Stands in for the material table's product column: a
                    printing order's lines are free text, so the first one
                    (and a count of the rest) is what identifies the order at
                    a glance. */}
                <th className={styles.tableHeadCell}>Services</th>
                <th className={styles.tableHeadCell}>Before tax</th>
                <th className={styles.tableHeadCell}>After tax</th>
              </tr>
            </thead>
            <tbody>
              {sortedPrintingOrders.map((order, index) => (
                <tr
                  key={order.id || `${order.purchaseOrderNo}-${index}`}
                  onDoubleClick={() => setModalState({ mode: "printingEdit", order })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{order.purchaseOrderNo}</td>
                  <td className={styles.tableCell}>{new Date(order.date).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{vendorsById.get(order.vendorId)?.registeredName ?? "—"}</td>
                  <td className={styles.tableCell}>
                    {order.descriptions.length === 0
                      ? "—"
                      : order.descriptions.length === 1
                        ? order.descriptions[0]
                        : `${order.descriptions[0]} +${order.descriptions.length - 1} more`}
                  </td>
                  <td className={styles.tableCell}>₹{order.totalAmountBeforeTax.toFixed(2)}</td>
                  <td className={styles.tableCell}>₹{order.totalAmountAfterTax.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadState === "loading" && <p className={styles.pageSubtext}>Loading printing purchase orders…</p>}
          {loadState === "loaded" && printingOrders.length === 0 && (
            <p className={styles.pageSubtext}>No printing purchase orders yet.</p>
          )}
        </div>
      )}

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
          nextPurchaseOrderNo={nextOrderNo(orders.map((order) => order.purchaseOrderNo))}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {modalState?.mode === "printingChoose" && (
        <PurchaseOrderSourceModal
          kind="printing"
          onChoose={(source) =>
            setModalState(source === "upload" ? { mode: "printingUpload" } : { mode: "printingAdd" })
          }
          onClose={() => setModalState(null)}
        />
      )}

      {modalState?.mode === "printingUpload" && (
        <PrintingPurchaseInvoiceUploadModal
          onParsed={(prefill, pdfFile) => setModalState({ mode: "printingAdd", prefill, pdfFile })}
          onFillManually={() => setModalState({ mode: "printingAdd" })}
          onClose={() => setModalState(null)}
        />
      )}

      {(modalState?.mode === "printingAdd" || modalState?.mode === "printingEdit") && (
        <PrintingPurchaseOrderFormModal
          mode={modalState.mode === "printingEdit" ? "edit" : "add"}
          initialOrder={modalState.mode === "printingEdit" ? modalState.order : undefined}
          prefill={modalState.mode === "printingAdd" ? modalState.prefill : undefined}
          initialPdfFile={modalState.mode === "printingAdd" ? modalState.pdfFile : undefined}
          vendors={vendorOptions}
          ownStateCode={ownStateCode}
          nextPurchaseOrderNo={nextOrderNo(printingOrders.map((order) => order.purchaseOrderNo))}
          onClose={() => setModalState(null)}
          onSaved={handlePrintingSaved}
        />
      )}
    </>
  );
}
