"use client";

// ---------------------------------------------------------------------------
// <PurchaseOrdersTab> — "Purchase orders" tab on /admin/orders
// ---------------------------------------------------------------------------
// Two levels of view behind one tab, on the .filterToggleRow pattern that
// pairs two .viewToggle pills on a row (see vendors-page-client.tsx). The
// outer split is the one that matters for tax; the inner one only applies to
// billed purchases, so its pill is hidden on the unbilled side:
//
//   Billed | Unbilled        <- outer: is there a vendor bill behind this?
//     Material | Printing    <- inner: billed only
//
// Three genuinely different documents, not filters over one list:
//   - Material  -> #purchase_orders. Line items are PRODUCTS, and saving one
//                  moves stock (backend/app/api/routes/orders.py).
//   - Printing  -> #printing_purchase_orders. Line items are SERVICES the
//                  vendor described, and nothing about them touches products
//                  or inventory (backend/app/api/routes/printing_orders.py).
//   - Unbilled  -> #unbilled_purchase_orders. Stock bought with no bill at
//                  all: no GST, no purchase invoice, no vendor GSTIN needed,
//                  and its line items may name products that don't exist yet
//                  (backend/app/api/routes/unbilled_orders.py). It DOES move
//                  stock, like material.
// Which of the first two a vendor belongs to is VendorDetails.vendor_type, so
// each of those views' vendor pickers offers only its own kind and the
// backend rejects the other. Unbilled offers every active vendor, GSTIN or
// not — a supplier who raises no bill routinely has neither.
//
// Adding is a three-step flow on the two BILLED sides, since either can be
// started from the vendor's own invoice:
//   "choose" -> purchase-order-source-modal.tsx asks which way
//   "upload" -> the matching upload modal reads the vendor's PDF and hands
//               back the values it found
//   "add"    -> the matching form, empty or pre-filled for review
// Creating an order also raises its purchase invoice server-side, so both
// paths show up on /admin/invoices without anything being added there.
//
// Unbilled skips all of that: there is no vendor PDF to read, so "+ New
// unbilled purchase" opens its form directly, and nothing it saves reaches
// the invoices page.
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
import { UnbilledPurchaseOrderFormModal } from "@/components/admin/unbilled-purchase-order-form-modal";
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
import {
  fetchUnbilledProducts,
  fetchUnbilledPurchaseOrders,
  type UnbilledProductOption,
  type UnbilledPurchaseOrder,
} from "@/lib/unbilled-purchase-orders";
import { fetchVendors, fetchVendorsList, type Vendor, type VendorOption } from "@/lib/vendors";
import { fetchProducts, type Product } from "@/lib/products";
import { fetchProfileDetails } from "@/lib/profile-details";
import { resolveStateCode } from "@/lib/gst";
import styles from "@/styles/dashboard.module.css";

// The inner pill's two values. Which of them is showing is irrelevant while
// `section` is "unbilled" — that pill isn't rendered — but it is remembered,
// so switching back to Billed returns to the list the admin left.
type View = "material" | "printing";
type Section = "billed" | "unbilled";

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
  // No "choose"/"upload" twins: an unbilled purchase has no vendor document
  // to read, so its add button opens the form directly.
  | { mode: "unbilledAdd" }
  | { mode: "unbilledEdit"; order: UnbilledPurchaseOrder }
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
  const [section, setSection] = useState<Section>("billed");
  const [view, setView] = useState<View>("material");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [printingOrders, setPrintingOrders] = useState<PrintingPurchaseOrder[]>([]);
  const [unbilledOrders, setUnbilledOrders] = useState<UnbilledPurchaseOrder[]>([]);
  // The unbilled products a purchase line can point at instead of creating
  // one. Fetched with the rest of the tab's data rather than inside the form,
  // same reasoning as ownStateCode below.
  const [unbilledProducts, setUnbilledProducts] = useState<UnbilledProductOption[]>([]);
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
  const sortedUnbilledOrders = [...unbilledOrders].sort(byDateThenId);
  const unbilledTotal = unbilledOrders.reduce((sum, order) => sum + order.totalAmount, 0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchPurchaseOrders(),
      fetchPrintingPurchaseOrders(),
      fetchUnbilledPurchaseOrders(),
      fetchUnbilledProducts(),
      fetchVendors(),
      fetchVendorsList(),
      fetchProducts(),
      fetchProfileDetails(),
    ])
      .then(
        ([
          orderData,
          printingOrderData,
          unbilledOrderData,
          unbilledProductData,
          vendorData,
          vendorOptionData,
          productData,
          profile,
        ]) => {
          if (cancelled) return;
          setOrders(orderData);
          setPrintingOrders(printingOrderData);
          setUnbilledOrders(unbilledOrderData);
          setUnbilledProducts(unbilledProductData);
          setVendors(vendorData);
          setVendorOptions(vendorOptionData);
          setProducts(productData);
          setOwnStateCode(resolveStateCode(profile.state_code, profile.gstin));
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

  // Re-fetches the product list alongside the orders, unlike the two billed
  // handlers: an unbilled purchase can CREATE products as a side-effect of
  // saving, so the picker would otherwise keep offering the stale list until
  // the page was reloaded.
  function handleUnbilledSaved() {
    setModalState(null);
    Promise.all([fetchUnbilledPurchaseOrders(), fetchUnbilledProducts()])
      .then(([orderData, productData]) => {
        setUnbilledOrders(orderData);
        setUnbilledProducts(productData);
      })
      .catch(() => {});
  }

  const isUnbilled = section === "unbilled";
  const isPrinting = !isUnbilled && view === "printing";

  return (
    <>
      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Purchase order billing">
          <button
            type="button"
            role="tab"
            aria-selected={!isUnbilled}
            onClick={() => setSection("billed")}
            className={`${styles.viewToggleButton} ${!isUnbilled ? styles.viewToggleButtonActive : ""}`}
          >
            Billed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isUnbilled}
            onClick={() => setSection("unbilled")}
            className={`${styles.viewToggleButton} ${isUnbilled ? styles.viewToggleButtonActive : ""}`}
          >
            Unbilled
          </button>
        </div>

        {/* Material/Printing is a split WITHIN billed purchases — there is no
            unbilled printing order, since a printing vendor invoices — so
            this pill goes away entirely rather than showing a disabled or
            empty option. */}
        {!isUnbilled && (
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
        )}

        <Button
          type="button"
          variant="primary"
          className={styles.filterToggleRowAction}
          onClick={() =>
            setModalState(
              isUnbilled
                ? // Straight to the form: there is no vendor invoice to read,
                  // so the choose/upload steps the billed sides take would
                  // have nothing to offer.
                  { mode: "unbilledAdd" }
                : { mode: isPrinting ? "printingChoose" : "choose" },
            )
          }
        >
          {isUnbilled
            ? "+ New unbilled purchase"
            : isPrinting
              ? "+ New printing purchase order"
              : "+ New purchase order"}
        </Button>
      </div>

      {!isUnbilled && !isPrinting && (
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

      {!isUnbilled && isPrinting && (
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

      {isUnbilled && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Purchase no.</th>
                <th className={styles.tableHeadCell}>Date</th>
                <th className={styles.tableHeadCell}>Vendor</th>
                {/* Stands in for the material table's missing product
                    column, the same way the printing table's Services column
                    does: the first item and a count of the rest is what
                    identifies the purchase at a glance. */}
                <th className={styles.tableHeadCell}>Items</th>
                {/* One amount, not the material table's before/after-tax
                    pair — there is no tax on an unbilled purchase. */}
                <th className={styles.tableHeadCell}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sortedUnbilledOrders.map((order, index) => (
                <tr
                  key={order.id}
                  onDoubleClick={() => setModalState({ mode: "unbilledEdit", order })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{order.purchaseOrderNo}</td>
                  <td className={styles.tableCell}>{new Date(order.date).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{vendorsById.get(order.vendorId)?.registeredName ?? "—"}</td>
                  <td className={styles.tableCell}>
                    {order.productNames.length === 0
                      ? "—"
                      : order.productNames.length === 1
                        ? order.productNames[0]
                        : `${order.productNames[0]} +${order.productNames.length - 1} more`}
                  </td>
                  <td className={styles.tableCell}>₹{order.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadState === "loading" && <p className={styles.pageSubtext}>Loading unbilled purchases…</p>}
          {loadState === "loaded" && unbilledOrders.length === 0 && (
            <p className={styles.pageSubtext}>No unbilled purchases yet.</p>
          )}
          {/* The only place this spend is totalled. It is deliberately absent
              from /admin/accounts, which reports GST-bearing purchases and
              reclaimable input credit — an unbilled purchase has neither, and
              listing it there would invite it into a tax figure. It still
              reaches margin through the product's vendor_rate, which
              #sales_order_costing defaults each line's cost from. */}
          {loadState === "loaded" && unbilledOrders.length > 0 && (
            <p className={styles.pageSubtext}>Total unbilled spend: ₹{unbilledTotal.toFixed(2)}</p>
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

      {(modalState?.mode === "unbilledAdd" || modalState?.mode === "unbilledEdit") && (
        <UnbilledPurchaseOrderFormModal
          mode={modalState.mode === "unbilledEdit" ? "edit" : "add"}
          initialOrder={modalState.mode === "unbilledEdit" ? modalState.order : undefined}
          // Every active vendor, unfiltered: no GSTIN rule and no vendor_type
          // rule applies to a purchase with no bill behind it.
          vendors={vendorOptions}
          unbilledProducts={unbilledProducts}
          onClose={() => setModalState(null)}
          onSaved={handleUnbilledSaved}
        />
      )}
    </>
  );
}
