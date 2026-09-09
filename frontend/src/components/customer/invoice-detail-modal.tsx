"use client";

// ---------------------------------------------------------------------------
// <CustomerInvoiceDetailModal> — read-only popup opened from a row on
// <CustomerInvoicesPageClient>
// ---------------------------------------------------------------------------
// The list only carries enough to identify an invoice (number, date, total);
// this fetches the rest on demand — line items, the GST split, and the
// billing details on file — from GET /customer/get_my_invoice_details, which
// refuses any invoice not billed to the signed-in client (see
// backend/app/api/routes/customer_invoices.py).
//
// Nothing here is editable, and deliberately so: an invoice is a document
// that has already been issued. Everything a client can do with it is on the
// two buttons at the bottom — take the PDF, or close.
//
// Mirrors admin/inventory-history-detail-modal.tsx's shape, with the fetch
// living here rather than in the parent so opening a row doesn't make the
// whole table wait on a second request.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import {
  fetchMyInvoiceDetail,
  formatAmount,
  type CustomerInvoice,
  type CustomerInvoiceDetail,
} from "@/lib/customer-invoices";
import styles from "@/styles/dashboard.module.css";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export function CustomerInvoiceDetailModal({
  invoice,
  downloading,
  onDownload,
  onClose,
}: {
  invoice: CustomerInvoice;
  downloading: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CustomerInvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchMyInvoiceDetail(invoice.id)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this invoice's details. Please try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  const isProforma = invoice.type === "proforma";
  // Which GST heads to show. taxKind is null only on invoices raised before
  // it was recorded on the row, so those fall back to whichever amounts
  // actually carry the tax.
  const showIgst = detail
    ? detail.taxKind === "igst" || (detail.taxKind === null && detail.totalIgstAmount > 0)
    : false;
  const showCgstSgst = detail
    ? detail.taxKind === "cgst_sgst" ||
      (detail.taxKind === null && (detail.totalCgstAmount > 0 || detail.totalSgstAmount > 0))
    : false;
  // Only shown when something on this invoice was actually discounted — an
  // all-zero column is noise on the majority of invoices, and proforma lines
  // never carry one at all.
  const showDiscount = detail?.lineItems.some((item) => item.discount > 0) ?? false;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-invoice-modal-title"
        className={`${styles.modalPanel} ${styles.invoiceDetailPanel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="customer-invoice-modal-title" className={styles.modalTitle}>
            {isProforma ? "Proforma invoice" : "Tax invoice"} {invoice.invoiceNoDisplay}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.formGrid}>
            <div>
              <span className={styles.formLabel}>Invoice date</span>
              <p className={styles.formStaticValue}>{formatDate(invoice.date)}</p>
            </div>

            <div>
              <span className={styles.formLabel}>Due date</span>
              <p className={styles.formStaticValue}>{formatDate(invoice.dueDate)}</p>
            </div>

            {!isProforma && (
              <div>
                <span className={styles.formLabel}>Order</span>
                <p className={styles.formStaticValue}>
                  {invoice.salesOrderNos.length > 0
                    ? invoice.salesOrderNos.map((orderNo) => `SO-${orderNo}`).join(", ")
                    : "—"}
                </p>
              </div>
            )}

            {detail && !isProforma && detail.transport && (
              <div>
                <span className={styles.formLabel}>Transport</span>
                <p className={styles.formStaticValue}>{detail.transport}</p>
              </div>
            )}

            {detail && detail.placeOfSupplyName && (
              <div>
                <span className={styles.formLabel}>Place of supply</span>
                <p className={styles.formStaticValue}>
                  {detail.placeOfSupplyName}
                  {detail.placeOfSupplyCode ? ` (${detail.placeOfSupplyCode})` : ""}
                </p>
              </div>
            )}
          </div>

          {detail && (
            <div>
              <span className={styles.formLabel}>Billed to</span>
              <p className={styles.formStaticValue}>{detail.billedToName}</p>
              <p className={styles.pageSubtext}>{detail.billedToAddress}</p>
              {detail.billedToGstin && (
                <p className={styles.pageSubtext}>GSTIN: {detail.billedToGstin}</p>
              )}
            </div>
          )}

          {detail && detail.description && (
            <div>
              <span className={styles.formLabel}>Description</span>
              <p className={styles.formStaticValue}>{detail.description}</p>
            </div>
          )}

          {!detail && !error && <p className={styles.pageSubtext}>Loading invoice details…</p>}

          {detail && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Item</th>
                    <th className={styles.tableHeadCell}>HSN</th>
                    <th className={styles.tableHeadCell}>Qty</th>
                    <th className={styles.tableHeadCell}>Rate</th>
                    {showDiscount && <th className={styles.tableHeadCell}>Discount</th>}
                    <th className={styles.tableHeadCell}>Taxable</th>
                    <th className={styles.tableHeadCell}>GST %</th>
                    <th className={styles.tableHeadCell}>Tax</th>
                    <th className={styles.tableHeadCell}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lineItems.map((item, index) => (
                    <tr key={`${item.productName}-${index}`} className={styles.tableRow}>
                      <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                        {item.productName}
                      </td>
                      <td className={styles.tableCell}>{item.hsnCode || "—"}</td>
                      <td className={styles.tableCell}>{item.quantity}</td>
                      <td className={styles.tableCell}>{formatAmount(item.rate)}</td>
                      {showDiscount && (
                        <td className={styles.tableCell}>{formatAmount(item.discount)}</td>
                      )}
                      <td className={styles.tableCell}>{formatAmount(item.taxableValue)}</td>
                      <td className={styles.tableCell}>{item.taxPerc}%</td>
                      <td className={styles.tableCell}>{formatAmount(item.taxAmount)}</td>
                      <td className={styles.tableCell}>{formatAmount(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.lineItems.length === 0 && (
                <p className={styles.pageSubtext}>No line items on this invoice.</p>
              )}
            </div>
          )}

          {detail && (
            <div className={styles.totalsRow}>
              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Taxable value</p>
                <p className={styles.totalsRowValue}>{formatAmount(detail.totalAmountBeforeTax)}</p>
              </div>

              {showIgst && (
                <div className={styles.totalsRowItem}>
                  <p className={styles.totalsRowLabel}>IGST</p>
                  <p className={styles.totalsRowValue}>{formatAmount(detail.totalIgstAmount)}</p>
                </div>
              )}

              {showCgstSgst && (
                <>
                  <div className={styles.totalsRowItem}>
                    <p className={styles.totalsRowLabel}>CGST</p>
                    <p className={styles.totalsRowValue}>{formatAmount(detail.totalCgstAmount)}</p>
                  </div>
                  <div className={styles.totalsRowItem}>
                    <p className={styles.totalsRowLabel}>SGST</p>
                    <p className={styles.totalsRowValue}>{formatAmount(detail.totalSgstAmount)}</p>
                  </div>
                </>
              )}

              {/* The catch-all for an invoice whose heads aren't recorded and
                  whose per-head amounts are all zero — the tax was still
                  charged, so it has to appear somewhere. */}
              {!showIgst && !showCgstSgst && (
                <div className={styles.totalsRowItem}>
                  <p className={styles.totalsRowLabel}>GST</p>
                  <p className={styles.totalsRowValue}>{formatAmount(detail.totalTaxAmount)}</p>
                </div>
              )}

              <div className={styles.totalsRowItem}>
                <p className={styles.totalsRowLabel}>Total</p>
                <p className={styles.totalsRowValue}>{formatAmount(detail.totalAmountAfterTax)}</p>
              </div>
            </div>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose}>
                Close
              </Button>
              <Button type="button" variant="primary" onClick={onDownload} disabled={downloading}>
                {downloading ? "Preparing…" : "Download PDF"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
