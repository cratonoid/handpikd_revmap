"use client";

// ---------------------------------------------------------------------------
// <QuotationsTab> — the interactive body of /admin/quotation
// ---------------------------------------------------------------------------
// Mirrors invoices-tab.tsx: GET /admin/get_quotation_details only ever
// returns active (non-deleted) quotations. "+ New quotation" opens the popup
// in "add" mode (its "Generate quotation" button saves AND immediately
// downloads the PDF — see quotation-form-modal.tsx); double-clicking a row
// opens it in "edit" mode. The per-row "Download" button re-generates the
// PDF on demand for an already-saved quotation.
//
// "Company details" opens the same PersonalDetailsModal invoices uses — it
// now also exposes quotation_tnc/quotation_notes, the seller-side terms and
// notes baked onto every generated quotation PDF (backend/app/services/
// quotation_pdf.py), stored in the #personal_details EAV table.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { QuotationFormModal } from "@/components/admin/quotation-form-modal";
import { PersonalDetailsModal } from "@/components/admin/personal-details-modal";
import { downloadQuotationPdf, fetchQuotations, type Quotation, type QuotationStatus } from "@/lib/quotations";
import { fetchPersonalDetails } from "@/lib/personal-details";
import { fetchCustomerList, type CustomerOption } from "@/lib/customers";
import { fetchProducts, type Product } from "@/lib/products";
import styles from "@/styles/dashboard.module.css";

type ModalState = { mode: "add" } | { mode: "edit"; quotation: Quotation } | null;
type LoadState = "loading" | "loaded";

const STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

export function QuotationsTab() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [personalDetails, setPersonalDetails] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const customersById = new Map(customers.map((c) => [c.id, c]));

  function loadAll() {
    return Promise.all([fetchQuotations(), fetchCustomerList(), fetchProducts(), fetchPersonalDetails()]).then(
      ([quotationData, customerData, productData, personalData]) => {
        setQuotations(quotationData);
        setCustomers(customerData);
        setProducts(productData);
        setPersonalDetails(personalData);
      },
    );
  }

  useEffect(() => {
    let cancelled = false;

    loadAll()
      .then(() => {
        if (!cancelled) setLoadState("loaded");
      })
      .catch(() => {
        // A failed fetch (e.g. the backend being unreachable) falls back to
        // an empty list rather than showing a scary error.
        if (!cancelled) setLoadState("loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches the full list instead of upserting a client-constructed
  // quotation, since update_quotation_details only returns {message} (and
  // even create_new_quotation's id/quotation_no aren't enough to reconstruct
  // every field) — same reasoning as invoices-tab.tsx's handleSaved.
  function handleSaved() {
    setModalState(null);
    fetchQuotations()
      .then(setQuotations)
      .catch(() => {
        // Keep showing the previous list rather than clearing it on a
        // transient refetch failure — the save itself already succeeded.
      });
  }

  function handleCompanyDetailsSaved() {
    setShowCompanyDetails(false);
    fetchPersonalDetails()
      .then(setPersonalDetails)
      .catch(() => {});
  }

  async function handleDownload(quotation: Quotation) {
    setDownloadError(null);
    setDownloadingId(quotation.id);
    try {
      await downloadQuotationPdf(quotation.id, quotation.quotationNo);
    } catch {
      setDownloadError(`Couldn't generate the PDF for quotation ${quotation.quotationNo}.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      {/* Title and both actions on one row — the shape every other module uses. */}
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Quotation</h1>
        </div>
        <div className={styles.modalActionsRight}>
          <Button type="button" variant="tertiary" onClick={() => setShowCompanyDetails(true)}>
            Company details
          </Button>
          <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
            + New quotation
          </Button>
        </div>
      </div>

      {downloadError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {downloadError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Quotation no.</th>
              <th className={styles.tableHeadCell}>Issue date</th>
              <th className={styles.tableHeadCell}>Valid till</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Amount</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {quotations.map((quotation, index) => {
              // A one-off buyer has no client row to look up — its name is
              // stored on the quotation itself (see lib/quotations.ts).
              const customerName =
                quotation.custId === null
                  ? quotation.customerName
                  : customersById.get(quotation.custId)?.name;
              return (
                <tr
                  key={quotation.id || `${quotation.quotationNo}-${index}`}
                  onDoubleClick={() => setModalState({ mode: "edit", quotation })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{quotation.quotationNo}</td>
                  <td className={styles.tableCell}>{new Date(quotation.date).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{new Date(quotation.validTill).toLocaleDateString()}</td>
                  <td className={styles.tableCell}>{customerName || "—"}</td>
                  <td className={styles.tableCell}>{STATUS_LABEL[quotation.status]}</td>
                  <td className={styles.tableCell}>₹{quotation.totalAmountAfterTax.toFixed(2)}</td>
                  <td className={styles.tableCell}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(quotation);
                      }}
                      disabled={downloadingId === quotation.id}
                      className={styles.triggerButtonBase}
                    >
                      {downloadingId === quotation.id ? "Generating…" : "Download"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading quotations…</p>}
        {loadState === "loaded" && quotations.length === 0 && (
          <p className={styles.pageSubtext}>No quotations created yet.</p>
        )}
      </div>

      {modalState && (
        <QuotationFormModal
          mode={modalState.mode}
          initialQuotation={modalState.mode === "edit" ? modalState.quotation : undefined}
          customers={customers}
          products={products}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {showCompanyDetails && (
        <PersonalDetailsModal
          initialValues={personalDetails}
          onClose={() => setShowCompanyDetails(false)}
          onSaved={handleCompanyDetailsSaved}
        />
      )}
    </>
  );
}
