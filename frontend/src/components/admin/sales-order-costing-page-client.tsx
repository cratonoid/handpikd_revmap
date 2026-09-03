"use client";

// ---------------------------------------------------------------------------
// <SalesOrderCostingPageClient> — the "Add details" costing sheet
// ---------------------------------------------------------------------------
// Renders /admin/orders/sales/[id]/details. One card per DISTINCT product on
// the order (an order listing the same product twice shows it once, with the
// quantities summed — see lib/sales-order-costing.ts), each pairing the
// admin's inputs with every figure derived from them.
//
// Cards rather than one wide table: there are eight inputs and sixteen
// derived figures per product, which no horizontally-scrolling table renders
// legibly.
//
// Numeric fields are held as plain strings and sanitized through
// sanitizeDecimalInput, the same way purchase-order-form-modal.tsx and
// sales-order-form-modal.tsx hold their rates — a controlled type="number"
// leaves stray leading zeros while being typed over. Number() at the edges
// (computeCostingFigures, save) turns them back into figures; an empty field
// reads as 0.
//
// Quantity is deliberately read-only here. It belongs to the order's line
// items, and changing it could move stock (see update_sales_order_details) —
// edit it on the order form instead.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import {
  computeCostingFigures,
  computeOrderTotals,
  fetchSalesOrderCosting,
  saveSalesOrderCosting,
  type CostingLine,
  type SalesOrderCosting,
} from "@/lib/sales-order-costing";
import { PlusIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";
type SaveState = "idle" | "saving" | "saved";

// String-backed mirror of CostingLine (see the sanitizeDecimalInput note
// above); productId/modelName/quantity stay typed since they're never edited.
type PrintingForm = {
  printingType: string;
  costPerUnit: string;
  isTaxable: boolean;
  taxPerc: string;
};

type LineForm = {
  productId: number;
  modelName: string;
  quantity: number;
  netPurchaseRate: string;
  purchaseTaxPerc: string;
  printingCosts: PrintingForm[];
  delivery: string;
  miscellaneous: string;
  netSalesRate: string;
  discount: string;
  salesTaxPerc: string;
};

function toFormValue(value: number): string {
  // A stored 0 shows as an empty field rather than a literal "0" the admin
  // has to select and type over — every one of these is optional and
  // defaults to nothing charged.
  return value ? String(value) : "";
}

function toLineForm(line: CostingLine): LineForm {
  return {
    productId: line.productId,
    modelName: line.modelName,
    quantity: line.quantity,
    netPurchaseRate: toFormValue(line.netPurchaseRate),
    purchaseTaxPerc: toFormValue(line.purchaseTaxPerc),
    printingCosts: line.printingCosts.map((printing) => ({
      printingType: printing.printingType,
      costPerUnit: toFormValue(printing.costPerUnit),
      isTaxable: printing.isTaxable,
      taxPerc: toFormValue(printing.taxPerc),
    })),
    delivery: toFormValue(line.delivery),
    miscellaneous: toFormValue(line.miscellaneous),
    netSalesRate: toFormValue(line.netSalesRate),
    discount: toFormValue(line.discount),
    salesTaxPerc: toFormValue(line.salesTaxPerc),
  };
}

function toCostingLine(form: LineForm): CostingLine {
  return {
    productId: form.productId,
    modelName: form.modelName,
    quantity: form.quantity,
    netPurchaseRate: Number(form.netPurchaseRate) || 0,
    purchaseTaxPerc: Number(form.purchaseTaxPerc) || 0,
    printingCosts: form.printingCosts.map((printing) => ({
      printingType: printing.printingType,
      costPerUnit: Number(printing.costPerUnit) || 0,
      isTaxable: printing.isTaxable,
      taxPerc: Number(printing.taxPerc) || 0,
    })),
    delivery: Number(form.delivery) || 0,
    miscellaneous: Number(form.miscellaneous) || 0,
    netSalesRate: Number(form.netSalesRate) || 0,
    discount: Number(form.discount) || 0,
    salesTaxPerc: Number(form.salesTaxPerc) || 0,
    // Only read on the way IN (to flag defaults, below) — computeCostingFigures
    // and the save payload both ignore it.
    isSaved: true,
  };
}

// The processes Handpikd actually quotes. The backend column is free text
// (see PrintingCost.printing_type), so this list can grow without a
// migration — and a row already holding some other value keeps it, via the
// extra <option> rendered below.
const PRINTING_TYPES = ["Laser", "UV", "Screen"];

// The rate printing almost always attracts. Only ever a starting point — the
// field stays editable, and it isn't applied at all until the row is marked
// taxable.
const DEFAULT_PRINTING_TAX_PERC = "18";

function emptyPrinting(): PrintingForm {
  return { printingType: "", costPerUnit: "", isTaxable: false, taxPerc: DEFAULT_PRINTING_TAX_PERC };
}

function currency(value: number): string {
  return `₹${value.toFixed(2)}`;
}

export function SalesOrderCostingPageClient({ salesOrderId }: { salesOrderId: number }) {
  const [order, setOrder] = useState<SalesOrderCosting | null>(null);
  const [lines, setLines] = useState<LineForm[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // A non-numeric route segment is a render-time fact, not something to
  // fetch or store — handled by the early return further down rather than by
  // setting state from inside the effect.
  const isValidId = Number.isFinite(salesOrderId);

  useEffect(() => {
    if (!isValidId) return;
    let cancelled = false;

    fetchSalesOrderCosting(salesOrderId)
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        setLines(data.lines.map(toLineForm));
        setLoadState("loaded");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setLoadState("error");
        setError(
          loadError instanceof Error ? loadError.message : "Couldn't reach the server. Please try again.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [salesOrderId, isValidId]);

  // Every derived figure on the page, recomputed from the current inputs on
  // each render — cheap (a handful of multiplications per product) and it
  // keeps a single source of truth rather than mirroring results in state.
  const figuresByLine = useMemo(() => lines.map((line) => computeCostingFigures(toCostingLine(line))), [lines]);

  // Not a plain sum of figuresByLine: the order's own discount off its net
  // amount belongs to the order rather than to any one product, so it is
  // applied across the summed lines here (see computeOrderTotals). Without
  // it this footer would disagree with the order's Before tax / After tax
  // columns on the orders table.
  const totals = useMemo(
    () => computeOrderTotals(lines.map(toCostingLine), order?.overallDiscount ?? 0),
    [lines, order],
  );

  const updateLine = useCallback((index: number, changes: Partial<LineForm>) => {
    setSaveState("idle");
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }, []);

  const updatePrinting = useCallback(
    (lineIndex: number, printingIndex: number, changes: Partial<PrintingForm>) => {
      setSaveState("idle");
      setLines((prev) =>
        prev.map((line, i) =>
          i === lineIndex
            ? {
                ...line,
                printingCosts: line.printingCosts.map((printing, j) =>
                  j === printingIndex ? { ...printing, ...changes } : printing,
                ),
              }
            : line,
        ),
      );
    },
    [],
  );

  function addPrinting(lineIndex: number) {
    setSaveState("idle");
    setLines((prev) =>
      prev.map((line, i) => (i === lineIndex ? { ...line, printingCosts: [...line.printingCosts, emptyPrinting()] } : line)),
    );
  }

  function removePrinting(lineIndex: number, printingIndex: number) {
    setSaveState("idle");
    setLines((prev) =>
      prev.map((line, i) =>
        i === lineIndex ? { ...line, printingCosts: line.printingCosts.filter((_, j) => j !== printingIndex) } : line,
      ),
    );
  }

  // True until this order's sheet has been saved at least once for every
  // product — the purchase figures shown for those are seeded from the
  // product master (vendor rate, GST %) rather than entered by anyone, which
  // is worth saying out loud before they're read as real costs.
  const hasUnsavedDefaults = order?.lines.some((line) => !line.isSaved) ?? false;

  async function handleSave() {
    setSaveState("saving");
    setError(null);
    try {
      await saveSalesOrderCosting(salesOrderId, lines.map(toCostingLine));
      setSaveState("saved");
      // Every line is now stored, so the "showing defaults" notice goes away
      // without needing a refetch.
      setOrder((prev) => (prev ? { ...prev, lines: prev.lines.map((line) => ({ ...line, isSaved: true })) } : prev));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't reach the server. Please try again.");
      setSaveState("idle");
    }
  }

  if (!isValidId || loadState === "error" || (loadState === "loaded" && !order)) {
    return (
      <>
        <p role="alert" className={styles.formError}>
          {isValidId ? error : "That isn't a valid sales order."}
        </p>
        <p className={styles.pageSubtext}>
          <Link href="/admin/orders" className={styles.costingBackLink}>
            ← Back to orders
          </Link>
        </p>
      </>
    );
  }

  if (loadState === "loading" || !order) {
    return <p className={styles.pageSubtext}>Loading sales order details…</p>;
  }

  return (
    <>
      <Link href="/admin/orders" className={styles.costingBackLink}>
        ← Back to orders
      </Link>

      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Order #{order.orderNo} details</h1>
          <p className={styles.pageSubtext}>
            {order.customerName} · {new Date(order.date).toLocaleDateString()} · {order.orderStatusName}
          </p>
        </div>
      </div>

      <p className={styles.costingIntro}>
        Costs and rates for each product on this order. Net Sales Rate and Sales Tax % are the order&apos;s own line
        item figures — editing them here updates the order&apos;s totals. Quantities come from the order form and are
        read-only.
      </p>

      {hasUnsavedDefaults && (
        <p className={styles.costingDefaultsNotice}>
          Some products have no saved details yet — their purchase rate and tax % below are defaults taken from the
          product master. Save to record them against this order.
        </p>
      )}

      {order.overallDiscount > 0 && (
        <p className={styles.costingDefaultsNotice}>
          This order has a {currency(order.overallDiscount)} discount on its net amount, entered on the order form
          rather than here. It is split across the products below in proportion to their value, and the totals at the
          foot of this page already account for it.
        </p>
      )}

      {lines.length === 0 && <p className={styles.pageSubtext}>This order has no line items to cost.</p>}

      {lines.map((line, lineIndex) => {
        const figures = figuresByLine[lineIndex];
        return (
          <section key={line.productId} className={styles.costingCard}>
            <header className={styles.costingCardHeader}>
              <h2 className={styles.costingCardTitle}>{line.modelName}</h2>
              <span className={styles.costingQtyBadge}>Qty {line.quantity}</span>
            </header>

            {/* ---------------- purchase side ---------------- */}
            <div className={styles.costingSection}>
              <p className={styles.costingSectionTitle}>Purchase</p>
              <div className={styles.costingInputGrid}>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Net purchase rate</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.netPurchaseRate}
                    onChange={(e) => updateLine(lineIndex, { netPurchaseRate: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Purchase tax %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.purchaseTaxPerc}
                    onChange={(e) => updateLine(lineIndex, { purchaseTaxPerc: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Delivery</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.delivery}
                    onChange={(e) => updateLine(lineIndex, { delivery: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Miscellaneous</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.miscellaneous}
                    onChange={(e) => updateLine(lineIndex, { miscellaneous: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
              </div>
              <p className={styles.costingHint}>Delivery and miscellaneous are flat amounts for the whole line.</p>
            </div>

            {/* ---------------- printing ---------------- */}
            <div className={styles.costingSection}>
              <div className={styles.costingSectionHeader}>
                <p className={styles.costingSectionTitle}>Printing</p>
                <button type="button" onClick={() => addPrinting(lineIndex)} className={styles.addContactButton}>
                  <PlusIcon className="h-3.5 w-3.5" /> Add printing type
                </button>
              </div>

              {line.printingCosts.length === 0 ? (
                <p className={styles.costingHint}>No printing on this product.</p>
              ) : (
                <>
                  <div className={styles.costingPrintingHeaderRow}>
                    <span className={styles.formLabel}>Type</span>
                    <span className={styles.formLabel}>Cost / unit</span>
                    <span className={styles.formLabel}>Taxable</span>
                    <span className={styles.formLabel}>Tax %</span>
                    <span />
                  </div>
                  {line.printingCosts.map((printing, printingIndex) => (
                    <div key={printingIndex} className={styles.costingPrintingRow}>
                      <select
                        value={printing.printingType}
                        onChange={(e) => updatePrinting(lineIndex, printingIndex, { printingType: e.target.value })}
                        aria-label={`${line.modelName} printing ${printingIndex + 1} type`}
                        className={styles.formInput}
                      >
                        <option value="">Select…</option>
                        {PRINTING_TYPES.map((printingType) => (
                          <option key={printingType} value={printingType}>
                            {printingType}
                          </option>
                        ))}
                        {/* A stored value that predates this list (or was
                            entered before it became a dropdown) would
                            otherwise show blank and be silently replaced on
                            the next save. */}
                        {printing.printingType && !PRINTING_TYPES.includes(printing.printingType) && (
                          <option value={printing.printingType}>{printing.printingType}</option>
                        )}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={printing.costPerUnit}
                        onChange={(e) =>
                          updatePrinting(lineIndex, printingIndex, { costPerUnit: sanitizeDecimalInput(e.target.value) })
                        }
                        aria-label={`${line.modelName} printing ${printingIndex + 1} cost per unit`}
                        className={styles.formInput}
                      />
                      <label className={styles.costingTaxableCell}>
                        <input
                          type="checkbox"
                          checked={printing.isTaxable}
                          onChange={(e) =>
                            updatePrinting(lineIndex, printingIndex, {
                              isTaxable: e.target.checked,
                              // Covers a row reloaded from a saved untaxed
                              // entry, whose tax % the backend zeroed (and
                              // toFormValue then blanked) — ticking Taxable
                              // shouldn't leave an empty field. A rate that's
                              // already there is left alone.
                              ...(e.target.checked && !printing.taxPerc
                                ? { taxPerc: DEFAULT_PRINTING_TAX_PERC }
                                : {}),
                            })
                          }
                          className={styles.selectCheckbox}
                        />
                        <span>Taxed</span>
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        // Disabled rather than hidden so the column stays
                        // aligned; the backend also zeroes tax_perc on an
                        // untaxed type, so a stale rate can't survive here.
                        disabled={!printing.isTaxable}
                        value={printing.isTaxable ? printing.taxPerc : ""}
                        onChange={(e) =>
                          updatePrinting(lineIndex, printingIndex, { taxPerc: sanitizeDecimalInput(e.target.value) })
                        }
                        aria-label={`${line.modelName} printing ${printingIndex + 1} tax percent`}
                        className={styles.formInput}
                      />
                      <button
                        type="button"
                        onClick={() => removePrinting(lineIndex, printingIndex)}
                        aria-label={`Remove printing ${printingIndex + 1}`}
                        className={styles.removeContactButton}
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <p className={styles.costingHint}>Printing costs are per piece and are multiplied by quantity.</p>
                </>
              )}
            </div>

            {/* ---------------- sales side ---------------- */}
            <div className={styles.costingSection}>
              <p className={styles.costingSectionTitle}>Sales</p>
              <div className={styles.costingInputGrid}>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Net sales rate</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.netSalesRate}
                    onChange={(e) => updateLine(lineIndex, { netSalesRate: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Discount</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.discount}
                    onChange={(e) => updateLine(lineIndex, { discount: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
                <label className={styles.costingField}>
                  <span className={styles.formLabel}>Sales tax %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.salesTaxPerc}
                    onChange={(e) => updateLine(lineIndex, { salesTaxPerc: sanitizeDecimalInput(e.target.value) })}
                    className={styles.formInput}
                  />
                </label>
              </div>
              <p className={styles.costingHint}>Discount is a flat amount off this line, not a percentage.</p>
            </div>

            {/* ---------------- derived figures ---------------- */}
            <div className={styles.costingFigures}>
              <div className={styles.costingFigureList}>
                <p className={styles.costingSectionTitle}>Cost</p>
                <FigureRow label="Net total cost" value={currency(figures.netTotalCost)} />
                <FigureRow label="Purchase tax rate" value={currency(figures.purchaseTaxRate)} />
                <FigureRow label="Purchase tax amount" value={currency(figures.purchaseTaxAmount)} />
                <FigureRow label="Gross purchase rate" value={currency(figures.grossPurchaseRate)} />
                <FigureRow label="Gross purchase cost" value={currency(figures.grossPurchaseCost)} />
                <FigureRow label="Net printing cost" value={currency(figures.netPrintingCost)} />
                <FigureRow label="Printing tax amount" value={currency(figures.printingTaxAmount)} />
                <FigureRow label="Gross printing cost" value={currency(figures.grossPrintingCost)} />
                <FigureRow label="Net final cost" value={currency(figures.netFinalCost)} strong />
              </div>

              <div className={styles.costingFigureList}>
                <p className={styles.costingSectionTitle}>Sales</p>
                <FigureRow label="Net sales price" value={currency(figures.netSalesPrice)} />
                <FigureRow label="Net subtotal" value={currency(figures.netSubtotal)} />
                <FigureRow label="Sales tax rate" value={currency(figures.salesTaxRate)} />
                <FigureRow label="Sales tax amount" value={currency(figures.salesTaxAmount)} />
                <FigureRow label="Gross sales price" value={currency(figures.grossSalesPrice)} strong />
                <div className={styles.costingProfitRow}>
                  <span className={styles.costingFigureLabel}>Profit</span>
                  <span
                    className={`${styles.costingProfitValue} ${figures.profit < 0 ? styles.negativeQuantity : ""}`}
                  >
                    {currency(figures.profit)}
                  </span>
                </div>
              </div>
            </div>

            {/* Purchase tax and printing tax are shown above but sit outside
                Net Final Cost, so the sheet says so rather than leaving the
                reader to reconcile the numbers themselves. */}
            <p className={styles.costingHint}>
              Net final cost = net total cost + net printing cost + delivery + miscellaneous. Purchase tax and printing
              tax are shown for reference and are not included in it, so profit is before input tax credit.
            </p>
          </section>
        );
      })}

      {lines.length > 0 && (
        <div className={styles.totalsRow}>
          <div className={styles.totalsRowItem}>
            <p className={styles.totalsRowLabel}>Total net final cost</p>
            <p className={styles.totalsRowValue}>{currency(totals.netFinalCost)}</p>
          </div>
          {totals.orderDiscount > 0 && (
            <>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Subtotal before order discount</p>
                <p className={styles.totalsRowValue}>
                  {currency(totals.netSubtotalBeforeOrderDiscount)}
                </p>
              </div>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Order discount</p>
                <p className={styles.totalsRowValue}>−{currency(totals.orderDiscount)}</p>
              </div>
            </>
          )}
          <div className={styles.totalsRowItem}>
            <p className={styles.totalsRowLabel}>Total net subtotal</p>
            <p className={styles.totalsRowValue}>{currency(totals.netSubtotal)}</p>
          </div>
          <div className={styles.totalsRowItem}>
            <p className={styles.totalsRowLabel}>Total sales tax</p>
            <p className={styles.totalsRowValue}>{currency(totals.salesTaxAmount)}</p>
          </div>
          <div className={styles.totalsRowItem}>
            <p className={styles.totalsRowLabel}>Total gross sales</p>
            <p className={styles.totalsRowValue}>{currency(totals.grossSalesPrice)}</p>
          </div>
          <div className={styles.totalsRowItem}>
            <p className={styles.totalsRowLabel}>Total profit</p>
            <p className={`${styles.totalsRowValue} ${totals.profit < 0 ? styles.negativeQuantity : ""}`}>
              {currency(totals.profit)}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}

      {lines.length > 0 && (
        <div className={styles.costingActions}>
          {saveState === "saved" && (
            <span aria-live="polite" className={styles.costingSavedNote}>
              Details saved. The order&apos;s totals have been updated.
            </span>
          )}
          <Button type="button" variant="tertiary" href="/admin/orders">
            Back
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? "Saving…" : "Save details"}
          </Button>
        </div>
      )}
    </>
  );
}

function FigureRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`${styles.costingFigureRow} ${strong ? styles.costingFigureRowStrong : ""}`}>
      <span className={styles.costingFigureLabel}>{label}</span>
      <span className={styles.costingFigureValue}>{value}</span>
    </div>
  );
}
