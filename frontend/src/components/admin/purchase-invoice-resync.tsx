"use client";

// ---------------------------------------------------------------------------
// <PurchaseInvoiceResync> — "Resync with orders" on the Purchase Invoices tab
// ---------------------------------------------------------------------------
// Administrator only. Invoices raised before order edits carried over to
// them can still show an order's old totals. This previews every invoice
// that disagrees with its order (old -> new, nothing written), then applies
// the fix on confirmation. See lib/purchase-invoices.ts.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { fetchMyAccess } from "@/lib/access";
import {
  applyPurchaseInvoiceResync,
  previewPurchaseInvoiceResync,
  type InvoiceResync,
} from "@/lib/purchase-invoices";
import styles from "@/styles/dashboard.module.css";

const FIELD_LABELS: Record<string, string> = {
  vendor_id: "Vendor (id)",
  total_amount_before_tax: "Before tax",
  total_tax_amount: "Tax",
  total_amount_after_tax: "After tax",
  tax_kind: "GST type",
  place_of_supply_code: "Place of supply (code)",
  place_of_supply_name: "Place of supply",
  total_igst_amount: "IGST",
  total_cgst_amount: "CGST",
  total_sgst_amount: "SGST",
};

type Stage = "closed" | "checking" | "preview" | "applying" | "done";

export function PurchaseInvoiceResync({ onApplied }: { onApplied: () => void }) {
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [stage, setStage] = useState<Stage>("closed");
  const [rows, setRows] = useState<InvoiceResync[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyAccess()
      .then((access) => {
        if (!cancelled) setIsAdministrator(access.sections === null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isAdministrator) return null;

  async function check() {
    setStage("checking");
    setError(null);
    try {
      setRows(await previewPurchaseInvoiceResync());
      setStage("preview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setStage("preview");
    }
  }

  async function apply() {
    setStage("applying");
    setError(null);
    try {
      setRows(await applyPurchaseInvoiceResync());
      setStage("done");
      onApplied();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setStage("preview");
    }
  }

  const busy = stage === "checking" || stage === "applying";
  const close = () => !busy && setStage("closed");

  return (
    <>
      <Button type="button" variant="tertiary" onClick={() => void check()} disabled={busy}>
        Resync with orders
      </Button>

      {stage !== "closed" && stage !== "checking" && (
        <div className={styles.modalBackdrop} onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resync-title"
            className={styles.modalPanel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="resync-title" className={styles.modalTitle}>
                {stage === "done" ? "Invoices updated" : "Resync purchase invoices with their orders"}
              </h2>
              <button type="button" onClick={close} disabled={busy} aria-label="Close" className={styles.modalCloseButton}>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className={styles.modalForm}>
              {error && (
                <p role="alert" className={styles.formError}>
                  {error}
                </p>
              )}
              <p className={styles.formHint}>
                {stage === "done"
                  ? `${rows.length} invoice(s) now match their orders.`
                  : rows.length === 0
                    ? "Every purchase invoice already matches its order. Nothing to change."
                    : `${rows.length} invoice(s) don't match their order. Applying copies the order's figures onto each invoice. The invoice number, date and attached PDF stay as they are.`}
              </p>
              {rows.map((row) => (
                <div key={`${row.kind}-${row.invoiceId}`} style={{ marginBottom: "0.75rem" }}>
                  <strong>
                    {row.invoiceNo} · order {row.purchaseOrderNo}
                    {row.kind === "printing" ? " (printing)" : ""}
                  </strong>
                  <ul>
                    {row.changes.map((change) => (
                      <li key={change.field} className={styles.formHint}>
                        {FIELD_LABELS[change.field] ?? change.field}: {change.old} → {change.new}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className={styles.modalActions}>
                <div className={styles.modalActionsRight}>
                  <Button type="button" variant="tertiary" onClick={close} disabled={busy}>
                    {stage === "done" || rows.length === 0 ? "Close" : "Cancel"}
                  </Button>
                  {stage !== "done" && rows.length > 0 && (
                    <Button type="button" variant="primary" onClick={() => void apply()} disabled={busy}>
                      {stage === "applying" ? "Applying…" : `Apply to ${rows.length} invoice(s)`}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
