"use client";

// ---------------------------------------------------------------------------
// <CampaignDetailPageClient> — one campaign's page, /admin/campaigns/[id]
// ---------------------------------------------------------------------------
// The whole Database address book (lib/database-contacts.ts) in the same
// Leads / Clients / Vendors tabs as /admin/database, read live, so a contact
// added there shows up here too. Each row also says where it stands in this
// campaign — not sent, sent (and when), failed or bounced — worked out by
// the backend from the campaign's sends (lib/campaigns.ts). The totals and
// the list of sends sit on a separate Summary view, so the Contacts view
// gives its room to the rows.
//
// Tick rows and "Send mail" opens <EmailComposeModal> for that tab's
// audience, where a template is picked; the send carries the campaign's id
// so it counts here. Bulk ticking skips contacts already reached by this
// campaign, those with no email, and addresses that bounced; a row's own
// button still sends to one of them on purpose (a follow-up or retry).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { CampaignFormModal } from "@/components/admin/campaign-form-modal";
import { EmailComposeModal } from "@/components/admin/email-compose-modal";
import { LeadChannelFilters, NO_CHANNEL_FILTERS, type LeadChannelFilterValues } from "@/components/admin/lead-channel-filters";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { fetchCampaign, type CampaignContactStatus, type CampaignDetail } from "@/lib/campaigns";
import { fetchContacts, matchesChannelFilter, type Contact, type ContactType } from "@/lib/database-contacts";
import { AUDIENCE_LABELS, RECIPIENT_STATUS_LABELS } from "@/lib/emails";
import { formatDate, formatDateTime } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

type LoadState = "loading" | "loaded" | "error";
type StatusFilter = "all" | "not_sent" | "sent" | "failed";
type View = "contacts" | "summary";

const VIEWS: { key: View; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "summary", label: "Summary" },
];

const TABS: { key: ContactType; label: string }[] = [
  { key: "lead", label: "Leads" },
  { key: "client", label: "Clients" },
  { key: "vendor", label: "Vendors" },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_sent", label: "Not sent" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed / bounced" },
];

// How often the page re-reads the campaign while any of its emails are
// still going out (the compose modal can be closed mid-send).
const POLL_INTERVAL_MS = 4000;

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

function matchesFilter(filter: StatusFilter, entry: CampaignContactStatus | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "not_sent") return entry === undefined;
  if (filter === "sent") return entry?.status === "sent";
  return entry?.status === "failed" || entry?.status === "bounced";
}

export function CampaignDetailPageClient({ campaignId }: { campaignId: number }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [view, setView] = useState<View>("contacts");
  const [tab, setTab] = useState<ContactType>("lead");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Leads only, as on /admin/database.
  const [channelFilters, setChannelFilters] = useState<LeadChannelFilterValues>(NO_CHANNEL_FILTERS);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [composeFor, setComposeFor] = useState<Contact[] | null>(null);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    const [nextDetail, nextContacts] = await Promise.all([fetchCampaign(campaignId), fetchContacts()]);
    setDetail(nextDetail);
    setContacts(nextContacts);
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCampaign(campaignId), fetchContacts()])
      .then(([nextDetail, nextContacts]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setContacts(nextContacts);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the campaign.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  // Keeps "Sending…" rows moving until the server has finished them.
  const anyPending = detail ? [...detail.statuses.values()].some((entry) => entry.status === "pending") : false;
  useEffect(() => {
    if (!anyPending || composeFor) return;
    const timer = window.setTimeout(() => {
      fetchCampaign(campaignId)
        .then(setDetail)
        .catch(() => setDetail((current) => (current ? { ...current } : current)));
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [anyPending, composeFor, campaignId, detail]);

  if (loadState === "loading") {
    return <p className={styles.pageSubtext}>Loading…</p>;
  }
  if (loadState === "error" || !detail) {
    return (
      <>
        <Link href="/admin/campaigns" className={styles.costingBackLink}>
          ← Back to campaigns
        </Link>
        <p className={styles.formError}>{loadError}</p>
      </>
    );
  }

  const { campaign, statuses, sends } = detail;
  const activeTab = TABS.find((option) => option.key === tab) ?? TABS[0];
  const isLead = tab === "lead";
  const nameLabel = isLead ? "Company name" : "Name";

  // Not reached by this campaign yet, or the last try failed.
  const awaitingMail = (contact: Contact) => {
    const entry = statuses.get(contact.id);
    return entry === undefined || entry.status === "failed";
  };
  const canBulkEmail = (contact: Contact) =>
    Boolean(contact.email) && !contact.emailBounceReason && awaitingMail(contact);

  const tabContacts = contacts.filter((contact) => contact.type === tab);
  const visibleContacts = tabContacts
    .filter((contact) => matchesFilter(statusFilter, statuses.get(contact.id)))
    .filter(
      (contact) =>
        !isLead ||
        (matchesChannelFilter(channelFilters.dataPresent, contact.outreachChannels) &&
          matchesChannelFilter(channelFilters.sentStatus, contact.sentChannels)),
    )
    .filter((contact) =>
      matchesSearch(search, [contact.name, contact.contactPerson, contact.contactRole, contact.email, contact.phone, contact.vendorType]),
    );

  const selectedContacts = tabContacts.filter((contact) => canBulkEmail(contact) && selectedIds.includes(contact.id));
  const selectableVisible = visibleContacts.filter(canBulkEmail);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((contact) => selectedIds.includes(contact.id));

  const withEmail = contacts.filter((contact) => contact.email);
  const notSentCount = withEmail.filter((contact) => !statuses.has(contact.id)).length;

  function switchTab(next: ContactType) {
    setTab(next);
    setSelectedIds([]);
  }

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAllVisible() {
    const visibleIds = selectableVisible.map((contact) => contact.id);
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...current, ...visibleIds.filter((id) => !current.includes(id))],
    );
  }

  function handleComposeClosed(sent: boolean) {
    setComposeFor(null);
    if (!sent) return;
    setSelectedIds([]);
    setRefreshError(null);
    reload().catch(() => setRefreshError("Emails were sent, but the list couldn't refresh. Reload the page to see them."));
  }

  return (
    <>
      <Link href="/admin/campaigns" className={styles.costingBackLink}>
        ← Back to campaigns
      </Link>

      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={`${styles.pageHeading} ${styles.pageHeadingKeep}`}>{campaign.name}</h1>
          <p className={styles.pageSubtext}>
            {campaign.description ? `${campaign.description} · ` : ""}Created {formatDate(utc(campaign.createdAt))}
          </p>
        </div>
        <div className={emailStyles.campaignHeaderActions}>
          <div className={styles.viewToggle} role="tablist" aria-label="Campaign view">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={view === option.key}
                onClick={() => setView(option.key)}
                className={`${styles.viewToggleButton} ${view === option.key ? styles.viewToggleButtonActive : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button type="button" variant="tertiary" onClick={() => setEditing(true)}>
            Edit campaign
          </Button>
        </div>
      </div>

      {view === "contacts" && (
        <>
          <div className={styles.filterToggleRow}>
            <div className={styles.viewToggle} role="tablist" aria-label="Database section">
              {TABS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === option.key}
                  onClick={() => switchTab(option.key)}
                  className={`${styles.viewToggleButton} ${tab === option.key ? styles.viewToggleButtonActive : ""}`}
                >
                  {option.label} ({contacts.filter((contact) => contact.type === option.key).length})
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              aria-label="Filter by campaign status"
              className={`${styles.formInput} ${emailStyles.campaignFilter}`}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>

            {isLead && <LeadChannelFilters value={channelFilters} onChange={setChannelFilters} />}

            <TableSearchInput
              value={search}
              onChange={setSearch}
              label={`Search ${activeTab.label.toLowerCase()}`}
              placeholder={`Search ${nameLabel.toLowerCase()}, email or phone…`}
            />

            <div className={styles.filterToggleRowEndGroup}>
              {selectedContacts.length > 0 && (
                <button type="button" onClick={() => setSelectedIds([])} className={emailStyles.smallButton}>
                  Clear selection
                </button>
              )}
              <Button
                type="button"
                variant="primary"
                disabled={selectedContacts.length === 0}
                onClick={() => setComposeFor(selectedContacts)}
                title={`Tick ${activeTab.label.toLowerCase()} to mail them. Contacts already reached by this campaign, without an email, or whose email bounced can't be ticked.`}
              >
                {selectedContacts.length === 0 ? "Send mail" : `Send mail to ${selectedContacts.length}`}
              </Button>
            </div>
          </div>

          {refreshError && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {refreshError}
            </p>
          )}

          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.databaseTable}`}>
              <thead>
                <tr>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colSelect}`}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={selectableVisible.length === 0}
                      aria-label={`Select all ${activeTab.label.toLowerCase()} not yet mailed`}
                      className={emailStyles.rowCheckbox}
                    />
                  </th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColSerial}`}>S.No</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>{nameLabel}</th>
                  {isLead && <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Contact person / Role</th>}
                  {tab === "vendor" && <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Type</th>}
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Email</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColPhone}`}>Phone no.</th>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colCampaignStatus}`}>Campaign status</th>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colCampaignAction}`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleContacts.map((contact, index) => {
                  const entry = statuses.get(contact.id);
                  return (
                    <tr key={contact.id} className={styles.tableRow}>
                      <td className={styles.tableCell}>
                        <input
                          type="checkbox"
                          checked={canBulkEmail(contact) && selectedIds.includes(contact.id)}
                          onChange={() => toggleSelected(contact.id)}
                          disabled={!canBulkEmail(contact)}
                          title={
                            !contact.email
                              ? "No email address"
                              : contact.emailBounceReason
                                ? "The last email to this address bounced. Fix the address in the Database to include it again."
                                : !awaitingMail(contact)
                                  ? "Already mailed by this campaign. Use the row's Resend button to send again."
                                  : undefined
                          }
                          aria-label={`Select ${contact.name}`}
                          className={emailStyles.rowCheckbox}
                        />
                      </td>
                      <td className={styles.tableCell}>{index + 1}</td>
                      <td
                        className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.databaseCellClip}`}
                        title={contact.name}
                      >
                        {contact.name}
                        {contact.emailBounceReason && (
                          <span className={emailStyles.bouncedBadge} title={`Email bounced: ${contact.emailBounceReason}`}>
                            Bounced
                          </span>
                        )}
                      </td>
                      {isLead && (
                        <td
                          className={`${styles.tableCell} ${styles.databaseCellClip}`}
                          title={[contact.contactPerson, contact.contactRole].filter(Boolean).join(" · ")}
                        >
                          {contact.contactPerson || "—"}
                          {contact.contactRole && <span className={emailStyles.contactRole}> · {contact.contactRole}</span>}
                        </td>
                      )}
                      {tab === "vendor" && (
                        <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.vendorType}>
                          {contact.vendorType || "—"}
                        </td>
                      )}
                      <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.email}>
                        {contact.email || "—"}
                      </td>
                      <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.phone}>
                        {contact.phone}
                      </td>
                      <td className={styles.tableCell}>
                        <CampaignStatusPill entry={entry} />
                      </td>
                      <td className={styles.tableCell}>
                        <button
                          type="button"
                          onClick={() => setComposeFor([contact])}
                          disabled={!contact.email || entry?.status === "pending"}
                          title={contact.email ? `Mail ${contact.email}` : "Add an email address in the Database first"}
                          className={styles.expenseRowButton}
                        >
                          {entry && entry.status !== "failed" ? "Resend" : "Send"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleContacts.length === 0 && (
              <p className={styles.pageSubtext}>
                {tabContacts.length === 0
                  ? `No ${activeTab.label.toLowerCase()} in the Database yet.`
                  : `No ${activeTab.label.toLowerCase()} match these filters.`}
              </p>
            )}
          </div>

        </>
      )}

      {view === "summary" && (
        <>
          <div className={`${styles.statGrid} ${emailStyles.campaignStats}`}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Reached</p>
              <p className={styles.statValue}>{campaign.sentCount}</p>
              <p className={styles.statCaption}>contacts emailed by this campaign</p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Not sent yet</p>
              <p className={styles.statValue}>{notSentCount}</p>
              <p className={styles.statCaption}>of {withEmail.length} contacts with an email</p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Failed / bounced</p>
              <p className={styles.statValue}>{campaign.failedCount + campaign.bouncedCount}</p>
              <p className={styles.statCaption}>
                {campaign.failedCount} failed · {campaign.bouncedCount} bounced
              </p>
            </div>
          </div>

          <div className={styles.dashboardSectionHeader}>
            <h2 className={styles.dashboardSectionTitle}>Mail sent from this campaign</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>Sent on</th>
                  <th className={styles.tableHeadCell}>To</th>
                  <th className={styles.tableHeadCell}>Template</th>
                  <th className={styles.tableHeadCell}>Subject</th>
                  <th className={styles.tableHeadCell}>Result</th>
                </tr>
              </thead>
              <tbody>
                {sends.map((send) => (
                  <tr key={send.id} className={styles.tableRow}>
                    <td className={styles.tableCell}>{formatDateTime(utc(send.createdAt))}</td>
                    <td className={styles.tableCell}>
                      {send.total} {AUDIENCE_LABELS[send.audience][send.total === 1 ? "singular" : "plural"].toLowerCase()}
                    </td>
                    <td className={styles.tableCell}>{send.templateName || "—"}</td>
                    <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={send.subject}>
                      {send.subject}
                    </td>
                    <td className={styles.tableCell}>
                      {send.sentCount}/{send.total} sent
                      {send.failedCount > 0 && <span className={emailStyles.failedText}> · {send.failedCount} failed</span>}
                      {send.bouncedCount > 0 && <span className={emailStyles.failedText}> · {send.bouncedCount} bounced</span>}
                      {!send.done && " · sending…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sends.length === 0 && <p className={styles.pageSubtext}>Nothing sent yet. Tick contacts above and press Send mail.</p>}
          </div>

        </>
      )}

      {composeFor && (
        <EmailComposeModal audience={tab} recipients={composeFor} campaignId={campaign.id} onClose={handleComposeClosed} />
      )}

      {editing && (
        <CampaignFormModal
          initialCampaign={campaign}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setDetail((current) => (current ? { ...current, campaign: saved } : current));
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function CampaignStatusPill({ entry }: { entry: CampaignContactStatus | undefined }) {
  if (!entry) {
    return <span className={`${emailStyles.campaignStatus} ${emailStyles.campaignStatus_none}`}>Not sent</span>;
  }
  const label =
    entry.status === "sent" && entry.sentAt
      ? `Sent ${formatDate(utc(entry.sentAt))}`
      : entry.status === "pending"
        ? "Sending…"
        : RECIPIENT_STATUS_LABELS[entry.status];
  const details = [
    entry.templateName && `Template: ${entry.templateName}`,
    entry.attempts > 1 && `${entry.attempts} attempts`,
    entry.error,
  ].filter(Boolean);
  return (
    <span
      className={`${emailStyles.campaignStatus} ${emailStyles[`campaignStatus_${entry.status}`]}`}
      title={details.join(" · ") || undefined}
    >
      {label}
    </span>
  );
}
