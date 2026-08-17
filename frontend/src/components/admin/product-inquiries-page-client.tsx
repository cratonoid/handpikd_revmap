"use client";

// ---------------------------------------------------------------------------
// <ProductInquiriesPageClient> — /admin/product-inquiries
// ---------------------------------------------------------------------------
// A flat table of every inquiry sent from the storefront cart's "Send
// inquiry" CTA (/cart — see components/cart/cart-page-client.tsx), with the
// same click-to-expand inline detail as inquiry-form-submissions-tab.tsx:
// clicking a row reveals that inquiry's product lines (name, unit price,
// quantity, line total) plus the visitor's message underneath it.
//
// The product name/price shown are the ones SNAPSHOTTED at submission time
// (see backend/app/models/product_inquiry.py), so an inquiry always renders
// what the visitor actually saw, even after a product is repriced, renamed,
// or removed.
import { Fragment, useEffect, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { fetchProductInquiries, type ProductInquiry } from "@/lib/product-inquiries";
import { formatInr } from "@/lib/public-products";
import styles from "@/styles/dashboard.module.css";

export function ProductInquiriesPageClient() {
  const [inquiries, setInquiries] = useState<ProductInquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    fetchProductInquiries()
      .then((result) => {
        if (!cancelled) setInquiries(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load product inquiries.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <>
      <h1 className={styles.pageHeading}>Product Inquiries</h1>
      <p className={styles.pageSubtext}>
        Inquiries sent from the storefront cart. Click a row to see the products and quantities requested.
      </p>

      <div className={styles.tableWrap}>
        {isLoading ? (
          <p className={styles.pageSubtext}>Loading inquiries…</p>
        ) : loadError ? (
          <p role="alert" className={styles.formError}>
            {loadError}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.tableHeadCell} ${styles.tableHeadCellSerial}`}>S.No</th>
                <th className={styles.tableHeadCell}>Name</th>
                <th className={styles.tableHeadCell}>Company</th>
                <th className={styles.tableHeadCell}>Email</th>
                <th className={styles.tableHeadCell}>Phone</th>
                <th className={styles.tableHeadCell}>Total</th>
                <th className={styles.tableHeadCell}>Submitted</th>
                <th className={styles.tableHeadCell}>Products</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((inquiry, index) => {
                const isExpanded = expandedIds.has(inquiry.id);

                return (
                  <Fragment key={inquiry.id}>
                    <tr
                      onClick={() => toggleExpanded(inquiry.id)}
                      className={styles.tableRow}
                      aria-expanded={isExpanded}
                      title="Click to view products"
                    >
                      <td className={`${styles.tableCell} ${styles.tableCellSerial}`}>{index + 1}</td>
                      <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{inquiry.name}</td>
                      <td className={styles.tableCell}>{inquiry.company}</td>
                      <td className={styles.tableCell}>{inquiry.email}</td>
                      <td className={styles.tableCell}>{inquiry.phone ?? "—"}</td>
                      <td className={styles.tableCell}>{formatInr(inquiry.totalAmount)}</td>
                      <td className={styles.tableCell}>
                        {new Date(inquiry.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </td>
                      <td className={styles.tableCell}>
                        <span className={styles.tableCategoryName}>
                          <ChevronRightIcon
                            className={`h-3.5 w-3.5 ${styles.tableChevron} ${isExpanded ? styles.tableChevronOpen : ""}`}
                          />
                          {inquiry.items.length} {inquiry.items.length === 1 ? "product" : "products"}
                        </span>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td className={`${styles.tableCell} ${styles.tableCellSerial} ${styles.tableDropdownCell}`} />
                        <td colSpan={7} className={styles.tableDropdownCell}>
                          <ul className={styles.treeRoot}>
                            {inquiry.items.map((item) => (
                              <li key={item.productId} className={styles.treeNode}>
                                <div className={styles.treeNodeRow}>
                                  <div className={styles.treeNodeMain}>
                                    <span className={styles.treeNodeNameRoot}>
                                      {item.productName}
                                      <span className={styles.treeNodeNote}>
                                        {item.quantity} × {formatInr(item.unitPrice)} = {formatInr(item.lineTotal)}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                          {inquiry.message && <p className={styles.pageSubtext}>“{inquiry.message}”</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {!isLoading && !loadError && inquiries.length === 0 && (
          <p className={styles.pageSubtext}>No inquiries yet.</p>
        )}
      </div>
    </>
  );
}
