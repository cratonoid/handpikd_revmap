"use client";

// ---------------------------------------------------------------------------
// <CampaignsPageClient> — the interactive half of /admin/campaigns
// ---------------------------------------------------------------------------
// Every campaign, newest first, with how many leads it has and how many of
// them are Sent. A new campaign opens straight onto its own page
// (campaign-detail-page-client.tsx), where its leads are added and worked. Delete asks once
// inline, the same way the Database table does; the campaign's sends stay in
// the Emails page's history.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CampaignFormModal } from "@/components/admin/campaign-form-modal";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { deleteCampaign, fetchCampaigns, type Campaign } from "@/lib/campaigns";
import { formatDate, formatDateTime } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

type LoadState = "loading" | "loaded" | "error";

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export function CampaignsPageClient() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCampaigns()
      .then((rows) => {
        if (cancelled) return;
        setCampaigns(rows);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the campaigns.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCampaigns = campaigns.filter((campaign) => matchesSearch(search, [campaign.name, campaign.description]));

  async function handleDelete(campaign: Campaign) {
    setRowError(null);
    setDeletingId(campaign.id);
    try {
      await deleteCampaign(campaign.id);
      setCampaigns((current) => current.filter((row) => row.id !== campaign.id));
      setConfirmingDeleteId(null);
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <h1 className={styles.pageHeading}>Campaigns</h1>

      <div className={`${styles.filterToggleRow} ${styles.databaseToolbar}`}>
        <TableSearchInput
          value={search}
          onChange={setSearch}
          label="Search campaigns"
          placeholder="Search campaign name or description…"
        />
        <div className={styles.filterToggleRowEndGroup}>
          <Button type="button" variant="primary" onClick={() => setAdding(true)}>
            + Add new campaign
          </Button>
        </div>
      </div>

      {rowError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {rowError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.databaseTable}`}>
          <thead>
            <tr>
              <th className={`${styles.tableHeadCell} ${styles.databaseColSerial}`}>S.No</th>
              <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Campaign</th>
              <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Description</th>
              <th className={styles.tableHeadCell}>Created</th>
              <th className={styles.tableHeadCell}>Leads</th>
              <th className={styles.tableHeadCell}>Sent</th>
              <th className={styles.tableHeadCell}>Last sent</th>
              <th className={`${styles.tableHeadCell} ${styles.databaseColActions}`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleCampaigns.map((campaign, index) => (
              <tr
                key={campaign.id}
                className={`${styles.tableRow} ${emailStyles.editableRow}`}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest("button, input, select, label, a")) return;
                  router.push(`/admin/campaigns/${campaign.id}`);
                }}
                title="Double-click to open"
              >
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.databaseCellClip}`} title={campaign.name}>
                  <Link href={`/admin/campaigns/${campaign.id}`}>{campaign.name}</Link>
                </td>
                <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={campaign.description}>
                  {campaign.description || "—"}
                </td>
                <td className={styles.tableCell}>{formatDate(utc(campaign.createdAt))}</td>
                <td className={styles.tableCell}>{campaign.leadCount}</td>
                <td className={styles.tableCell}>
                  {campaign.sentLeadCount}
                  {campaign.failedCount > 0 && <span className={emailStyles.failedText}> · {campaign.failedCount} failed</span>}
                  {campaign.bouncedCount > 0 && (
                    <span className={emailStyles.failedText}> · {campaign.bouncedCount} bounced</span>
                  )}
                </td>
                <td className={styles.tableCell}>
                  {campaign.lastSentAt ? formatDateTime(utc(campaign.lastSentAt)) : "Not sent yet"}
                </td>
                <td className={styles.tableCell}>
                  {confirmingDeleteId === campaign.id ? (
                    <div className={styles.deleteConfirmRow}>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={deletingId === campaign.id}
                        className={styles.expenseRowButton}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(campaign)}
                        disabled={deletingId === campaign.id}
                        className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                      >
                        {deletingId === campaign.id ? "Deleting…" : "Yes, delete"}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.deleteConfirmRow}>
                      <Link href={`/admin/campaigns/${campaign.id}`} className={styles.expenseRowButton}>
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(campaign.id)}
                        className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading…</p>}
        {loadState === "error" && <p className={styles.formError}>{loadError}</p>}
        {loadState === "loaded" && visibleCampaigns.length === 0 && (
          <p className={styles.pageSubtext}>
            {search ? "No campaigns match your search." : "No campaigns yet. Add one to start mailing your database."}
          </p>
        )}
      </div>

      {adding && (
        <CampaignFormModal
          onClose={() => setAdding(false)}
          onSaved={(campaign) => router.push(`/admin/campaigns/${campaign.id}`)}
        />
      )}
    </>
  );
}
