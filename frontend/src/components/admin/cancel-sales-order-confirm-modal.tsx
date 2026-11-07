"use client";

// ---------------------------------------------------------------------------
// <CancelSalesOrderConfirmModal> — shown before cancelling an order that has
// invoices
// ---------------------------------------------------------------------------
// Used by both ways of cancelling: the status dropdown in the sales orders
// table and the order form, which it opens on top of. Cancelling also cancels
// the order's unpaid invoices, so the admin sees which ones first. Moving the
// order back out of "Cancelled" brings them back.
//
// Its clicks are stopped from bubbling because, over the order form, they
// would otherwise reach that form's backdrop and close it.
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import type { SalesOrderCancellationImpact } from "@/lib/sales-orders";
import styles from "@/styles/dashboard.module.css";

export function cancellationAffectsInvoices(impact: SalesOrderCancellationImpact): boolean {
  return impact.unpaidInvoices.length > 0 || impact.paidInvoiceNos.length > 0;
}

export function CancelSalesOrderConfirmModal({
  orderNo,
  impact,
  onKeep,
  onConfirm,
}: {
  orderNo: number;
  impact: SalesOrderCancellationImpact;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-sales-order-title"
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <h2 id="cancel-sales-order-title" className={styles.modalTitle}>
            Cancel sales order SO-{orderNo}?
          </h2>
          <button type="button" className={styles.modalCloseButton} onClick={onKeep} aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          {impact.unpaidInvoices.length > 0 && (
            <div>
              <p className={styles.pageSubtext}>
                These unpaid invoices will be marked Cancelled on the invoices page. Changing the order back from
                Cancelled restores them, unless the order has been billed again by then.
              </p>
              <ul className={styles.backupWarningList}>
                {impact.unpaidInvoices.map((invoice) => (
                  <li key={invoice.invoiceNoDisplay}>
                    <strong>{invoice.invoiceNoDisplay}</strong>
                    {invoice.otherOrderNos.length > 0 && (
                      <>
                        {" "}
                        — also bills {invoice.otherOrderNos.map((no) => `SO-${no}`).join(", ")}, which will need a new
                        invoice if this order stays cancelled
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {impact.paidInvoiceNos.length > 0 && (
            <div>
              <p className={styles.pageSubtext}>
                These paid invoices stay as they are. Any refund has to be handled separately.
              </p>
              <ul className={styles.backupWarningList}>
                {impact.paidInvoiceNos.map((invoiceNo) => (
                  <li key={invoiceNo}>
                    <strong>{invoiceNo}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onKeep}>
                Keep order
              </Button>
              <Button type="button" variant="primary" onClick={onConfirm}>
                Cancel order
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
