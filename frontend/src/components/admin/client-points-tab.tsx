"use client";

// ---------------------------------------------------------------------------
// <ClientPointsTab> — the "Points" view of /admin/clients
// ---------------------------------------------------------------------------
// Every client's loyalty points at a glance, from
// GET /admin/get_customer_points_summary: what they have available, the next
// batch about to expire, and how much they've redeemed so far. Clicking a row
// opens that client's full ledger (<CustomerPointsSection>), which is where
// points are added and withdrawn — see lib/customer-points.ts for the rules.
import { useEffect, useState } from "react";
import { CustomerPointsSection } from "@/components/admin/customer-points-section";
import {
  matchesSearch,
  TableSearchInput,
} from "@/components/admin/table-search-input";
import { XMarkIcon } from "@/components/icons";
import {
  fetchCustomerPointsSummary,
  type CustomerPointsSummary,
} from "@/lib/customer-points";
import { addDaysToDateValue, nowAsDateValue } from "@/lib/datetime-input";
import { formatDate } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";
type Filter = "with-points" | "all";

// A batch expiring within this many days is flagged in the table, so the
// admin can nudge the client to use it.
const EXPIRING_SOON_DAYS = 7;

export function ClientPointsTab({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const [rows, setRows] = useState<CustomerPointsSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<Filter>("with-points");
  const [openRow, setOpenRow] = useState<CustomerPointsSummary | null>(null);
  // Bumped when the ledger popup closes, to re-read the summary it may have
  // changed.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCustomerPointsSummary()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setLoadState("loaded");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const soonCutoff = addDaysToDateValue(nowAsDateValue(), EXPIRING_SOON_DAYS);

  // Deleted clients are left out: their points can't be spent on a new
  // order. Most points first, so the clients worth a reminder lead.
  const visibleRows = rows
    .filter(
      (row) =>
        !row.isDeleted &&
        (filter === "all" || row.availablePoints > 0) &&
        matchesSearch(search, [row.customerName, row.companyOrDepartment]),
    )
    .sort(
      (a, b) =>
        b.availablePoints - a.availablePoints ||
        a.customerName.localeCompare(b.customerName),
    );

  const totalAvailable = visibleRows.reduce(
    (sum, row) => sum + row.availablePoints,
    0,
  );

  function closeLedger() {
    setOpenRow(null);
    setReloadKey((key) => key + 1);
  }

  return (
    <>
      <div className={styles.filterToggleRow}>
        <TableSearchInput
          value={search}
          onChange={onSearchChange}
          label="Search clients"
          placeholder="Search name or department…"
        />

        <div
          className={`${styles.viewToggle} ${styles.viewToggleEnd}`}
          role="tablist"
          aria-label="Clients shown"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "with-points"}
            onClick={() => setFilter("with-points")}
            className={`${styles.viewToggleButton} ${filter === "with-points" ? styles.viewToggleButtonActive : ""}`}
          >
            With points
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
            className={`${styles.viewToggleButton} ${filter === "all" ? styles.viewToggleButtonActive : ""}`}
          >
            All clients
          </button>
        </div>
      </div>

      {loadState === "loaded" && (
        <p className={styles.pageSubtext}>
          {totalAvailable.toLocaleString("en-IN")} points available across{" "}
          {visibleRows.length} client
          {visibleRows.length === 1 ? "" : "s"}. Click a client to add or
          withdraw points.
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Customer</th>
              <th className={styles.tableHeadCell}>Department</th>
              <th className={styles.tableHeadCell}>Available</th>
              <th className={styles.tableHeadCell}>Expiring next</th>
              <th className={styles.tableHeadCell}>Redeemed</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const expiringSoon =
                row.nextExpiryOn !== null && row.nextExpiryOn < soonCutoff;
              return (
                <tr
                  key={row.custId}
                  onClick={() => setOpenRow(row)}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td
                    className={`${styles.tableCell} ${styles.tableCellPrimary}`}
                  >
                    {row.customerName}
                  </td>
                  <td className={styles.tableCell}>
                    {row.companyOrDepartment || "—"}
                  </td>
                  <td
                    className={`${styles.tableCell} ${styles.tableCellPrimary}`}
                  >
                    {row.availablePoints.toLocaleString("en-IN")}
                  </td>
                  <td
                    className={`${styles.tableCell} ${expiringSoon ? styles.pointsExpiringSoon : ""}`}
                  >
                    {row.nextExpiryOn
                      ? `${row.nextExpiryPoints.toLocaleString("en-IN")} on ${formatDate(row.nextExpiryOn)}`
                      : "—"}
                  </td>
                  <td className={styles.tableCell}>
                    {row.redeemedPoints.toLocaleString("en-IN")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loadState === "loading" && (
          <p className={styles.pageSubtext}>Loading points…</p>
        )}
        {loadState === "error" && (
          <p className={styles.formError}>
            Couldn&apos;t load points. Please try again.
          </p>
        )}
        {loadState === "loaded" && visibleRows.length === 0 && (
          <p className={styles.pageSubtext}>
            {search.trim() !== ""
              ? "No clients match your search."
              : filter === "with-points"
                ? "No client has any points right now."
                : "No active clients."}
          </p>
        )}
      </div>

      {openRow && (
        <div className={styles.modalBackdrop} onClick={closeLedger}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-points-modal-title"
            className={styles.modalPanel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id="client-points-modal-title" className={styles.modalTitle}>
                {openRow.customerName}
                {openRow.companyOrDepartment
                  ? ` · ${openRow.companyOrDepartment}`
                  : ""}
              </h2>
              <button
                type="button"
                onClick={closeLedger}
                aria-label="Close"
                className={styles.modalCloseButton}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className={styles.modalForm}>
              <CustomerPointsSection custId={openRow.custId} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
