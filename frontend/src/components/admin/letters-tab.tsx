"use client";

// ---------------------------------------------------------------------------
// <LettersTab> — the interactive body of /admin/letters
// ---------------------------------------------------------------------------
// Same shape as quotations-tab.tsx: "+ New letter" opens the popup in "add"
// mode (its "Generate letter" button saves AND downloads the PDF), double-
// clicking a row opens it in "edit" mode, and the per-row "Download" button
// re-generates the PDF for a saved letter. "Company details" edits the
// letterhead itself (name, contact lines, address, signature).
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { LetterFormModal } from "@/components/admin/letter-form-modal";
import { PersonalDetailsModal } from "@/components/admin/personal-details-modal";
import { downloadLetterPdf, fetchLetters, type Letter } from "@/lib/letters";
import { fetchPersonalDetails } from "@/lib/personal-details";
import { fetchCustomers, type Customer } from "@/lib/customers";
import { byNewestFirst } from "@/lib/row-order";
import styles from "@/styles/dashboard.module.css";
import { formatDate } from "@/lib/format-date";

type ModalState = { mode: "add" } | { mode: "edit"; letter: Letter } | null;
type LoadState = "loading" | "loaded";

export function LettersTab() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [personalDetails, setPersonalDetails] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [modalState, setModalState] = useState<ModalState>(null);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const sortedLetters = [...letters].sort(byNewestFirst);

  useEffect(() => {
    let cancelled = false;

    // Customers only feed the form's "Fill from client" picker, so a
    // failure there (or in personal details) mustn't hide the letters list.
    Promise.allSettled([fetchLetters(), fetchCustomers(), fetchPersonalDetails()]).then(
      ([letterData, customerData, personalData]) => {
        if (cancelled) return;
        if (letterData.status === "fulfilled") setLetters(letterData.value);
        if (customerData.status === "fulfilled") setCustomers(customerData.value);
        if (personalData.status === "fulfilled") setPersonalDetails(personalData.value);
        setLoadState("loaded");
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved() {
    setModalState(null);
    fetchLetters()
      .then(setLetters)
      .catch(() => {
        // Keep the previous list on a transient refetch failure — the save
        // itself already succeeded.
      });
  }

  function handleCompanyDetailsSaved() {
    setShowCompanyDetails(false);
    fetchPersonalDetails()
      .then(setPersonalDetails)
      .catch(() => {});
  }

  async function handleDownload(letter: Letter) {
    setDownloadError(null);
    setDownloadingId(letter.id);
    try {
      await downloadLetterPdf(letter.id, letter.letterNo);
    } catch {
      setDownloadError(`Couldn't generate the PDF for letter ${letter.letterNo}.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Letters</h1>
        </div>
        <div className={styles.modalActionsRight}>
          <Button type="button" variant="tertiary" onClick={() => setShowCompanyDetails(true)}>
            Company details
          </Button>
          <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
            + New letter
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
              <th className={styles.tableHeadCell}>Ref no.</th>
              <th className={styles.tableHeadCell}>Date</th>
              <th className={styles.tableHeadCell}>To</th>
              <th className={styles.tableHeadCell}>Subject</th>
              <th className={styles.tableHeadCell}>PDF</th>
            </tr>
          </thead>
          <tbody>
            {sortedLetters.map((letter, index) => (
              <tr
                key={letter.id}
                onDoubleClick={() => setModalState({ mode: "edit", letter })}
                className={styles.tableRow}
              >
                <td className={styles.tableCell}>{sortedLetters.length - index}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{letter.letterNo}</td>
                <td className={styles.tableCell}>{formatDate(letter.date)}</td>
                <td className={styles.tableCell}>{letter.recipientName}</td>
                <td className={styles.tableCell}>{letter.subject || "—"}</td>
                <td className={styles.tableCell}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownload(letter);
                    }}
                    disabled={downloadingId === letter.id}
                    className={styles.triggerButtonBase}
                  >
                    {downloadingId === letter.id ? "Generating…" : "Download"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading letters…</p>}
        {loadState === "loaded" && letters.length === 0 && (
          <p className={styles.pageSubtext}>No letters drafted yet.</p>
        )}
      </div>

      {modalState && (
        <LetterFormModal
          mode={modalState.mode}
          initialLetter={modalState.mode === "edit" ? modalState.letter : undefined}
          customers={customers}
          personalDetails={personalDetails}
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
