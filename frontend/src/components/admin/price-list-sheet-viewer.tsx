"use client";

// ---------------------------------------------------------------------------
// <PriceListSheetViewer> — an Excel price list, viewed in the admin
// ---------------------------------------------------------------------------
// Opened from the /admin/price-lists table for .xlsx / .xls price lists. A
// browser can't open a workbook, so the backend reads it into text cells
// (GET /admin/get_price_list_sheets, see services/spreadsheet_preview.py)
// and this lays them out spreadsheet-style: a tab per worksheet, column
// letters across the top, row numbers down the side, both pinned while the
// grid scrolls. Values are what Excel last calculated, formatted as text;
// styling and merged cells aren't carried over, which is what the Download
// button (the original file) is for.
//
// The search box filters the active sheet's rows client-side. Matching rows
// keep their real row numbers, so a found price can still be pointed at
// ("row 214") when talking to the vendor.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { XMarkIcon } from "@/components/icons";
import { fetchPriceListSheets, openPriceListFile, type PriceList, type PriceListSheet } from "@/lib/price-lists";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";

// 0 -> A, 25 -> Z, 26 -> AA — Excel's own column naming.
function columnLetter(index: number): string {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  }
  return letter;
}

// Numbers, amounts and percentages line up on the right, as in Excel.
const NUMERIC_CELL = /^-?[\d,]+(\.\d+)?%?$/;

export function PriceListSheetViewer({ priceList, onClose }: { priceList: PriceList; onClose: () => void }) {
  const [sheets, setSheets] = useState<PriceListSheet[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeIndex, setActiveIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    fetchPriceListSheets(priceList.id)
      .then((data) => {
        setSheets(data);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, [priceList.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const sheet = sheets[activeIndex] ?? null;
  const columnCount = sheet ? Math.max(0, ...sheet.rows.map((row) => row.length)) : 0;
  // Row numbers are kept with each row so filtering doesn't renumber them.
  const visibleRows = (sheet?.rows ?? [])
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter(({ cells }) => matchesSearch(search, cells));

  async function handleDownload() {
    setDownloadError(null);
    try {
      await openPriceListFile(priceList);
    } catch {
      setDownloadError("Couldn't download the file. Please try again.");
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-list-sheet-title"
        className={`${styles.modalPanel} ${styles.modalPanelWide}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="price-list-sheet-title" className={styles.modalTitle}>
              {priceList.priceListName}
            </h2>
            {priceList.originalFilename && <p className={styles.pageSubtext}>{priceList.originalFilename}</p>}
          </div>
          <div className={styles.sheetViewerHeaderActions}>
            <Button type="button" variant="tertiary" onClick={() => void handleDownload()}>
              Download
            </Button>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className={styles.sheetViewerBody}>
          {downloadError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {downloadError}
            </p>
          )}

          {loadState === "loading" && <p className={styles.pageSubtext}>Reading workbook…</p>}
          {loadState === "error" && (
            <p role="alert" className={styles.formError}>
              Couldn&apos;t read this workbook. Download it to open it in Excel instead.
            </p>
          )}
          {loadState === "loaded" && sheets.length === 0 && (
            <p className={styles.pageSubtext}>This workbook has no visible sheets.</p>
          )}

          {sheet && (
            <>
              <div className={styles.sheetViewerToolbar}>
                {sheets.length > 1 && (
                  <div className={styles.catalogueCategoryTabs} role="tablist" aria-label="Worksheets">
                    {sheets.map((entry, index) => (
                      <button
                        key={`${index}-${entry.name}`}
                        type="button"
                        role="tab"
                        aria-selected={index === activeIndex}
                        onClick={() => setActiveIndex(index)}
                        className={`${styles.viewToggleButton} ${
                          index === activeIndex ? styles.viewToggleButtonActive : ""
                        }`}
                      >
                        {entry.name}
                      </button>
                    ))}
                  </div>
                )}
                <TableSearchInput
                  value={search}
                  onChange={setSearch}
                  label="Search this sheet"
                  placeholder="Search this sheet…"
                />
              </div>

              {sheet.truncated && (
                <p className={styles.formHint}>
                  This sheet is too large to show in full here — download the file to see all of it.
                </p>
              )}

              {sheet.rows.length === 0 ? (
                <p className={styles.pageSubtext}>This sheet is empty.</p>
              ) : visibleRows.length === 0 ? (
                <p className={styles.pageSubtext}>No rows match your search.</p>
              ) : (
                <div className={styles.sheetViewerScroll}>
                  <table className={styles.sheetTable}>
                    <thead>
                      <tr>
                        <th className={styles.sheetCorner} aria-label="Row" />
                        {Array.from({ length: columnCount }, (_, index) => (
                          <th key={index} scope="col" className={styles.sheetColumnHead}>
                            {columnLetter(index)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(({ cells, rowNumber }) => (
                        <tr key={rowNumber}>
                          <th scope="row" className={styles.sheetRowHead}>
                            {rowNumber}
                          </th>
                          {Array.from({ length: columnCount }, (_, index) => {
                            const value = cells[index] ?? "";
                            return (
                              <td
                                key={index}
                                className={`${styles.sheetCell} ${NUMERIC_CELL.test(value) ? styles.sheetCellNumeric : ""}`}
                              >
                                {value}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
