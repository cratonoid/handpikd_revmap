"use client";

// ---------------------------------------------------------------------------
// <CampaignDetailPageClient> — one campaign's page, /admin/campaigns/[id]
// ---------------------------------------------------------------------------
// The campaign's own list of leads (lib/campaigns.ts), laid out like the
// Database's Leads table. Per lead, three columns belong to this campaign
// alone: Status (Unsent / Sent), SD Status and Sent status (WhatsApp /
// Mail). The rest — name, contact person, phone, email and Data present —
// is the lead's Database row (lib/database-contacts.ts), so editing it here
// changes it in the Database and in every other campaign too, and a lead
// added here with "+ Add new lead" is added to the Database as well.
// "Add from Database" brings in leads that are already there. Removing a
// lead takes it out of this campaign only. Each column header has a funnel
// filter, as on /admin/database.
//
// Tick rows and "Send mail" opens <EmailComposeModal>; the send carries the
// campaign's id, and each delivered email marks that lead Sent with Mail
// ticked here. Bulk ticking skips leads already Sent in this campaign,
// those with no email, and addresses that bounced; a row's own button still
// sends to one of them on purpose (a follow-up or retry). The last email's
// result shows in the Last email column; the totals and the list of sends
// sit on a separate Summary view.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { CampaignAddLeadsModal } from "@/components/admin/campaign-add-leads-modal";
import { CampaignFormModal } from "@/components/admin/campaign-form-modal";
import { ColumnFilterDropdown } from "@/components/admin/column-filter-dropdown";
import { ContactFormModal } from "@/components/admin/contact-form-modal";
import { EmailComposeModal } from "@/components/admin/email-compose-modal";
import { StatusSelect } from "@/components/admin/status-select";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import {
  CAMPAIGN_LEAD_STATUS_OPTIONS,
  fetchCampaign,
  removeCampaignLead,
  updateCampaignLead,
  type CampaignContactStatus,
  type CampaignDetail,
  type CampaignLead,
  type CampaignLeadStatus,
} from "@/lib/campaigns";
import {
  CHANNEL_FILTER_CHOICES,
  fetchContacts,
  matchesChannelFilters,
  OUTREACH_OPTIONS,
  SD_STATUS_OPTIONS,
  updateDataPresent,
  type ChannelFilterChoice,
  type Contact,
  type OutreachChannel,
  type SdStatus,
} from "@/lib/database-contacts";
import { AUDIENCE_LABELS, RECIPIENT_STATUS_LABELS } from "@/lib/emails";
import { formatDate, formatDateTime } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

type LoadState = "loading" | "loaded" | "error";
type View = "leads" | "summary";
type ContactModalState = { mode: "add" } | { mode: "edit"; contact: Contact } | null;

const VIEWS: { key: View; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "summary", label: "Summary" },
];

const SD_STATUS_FILTER_CHOICES: { value: SdStatus | ""; label: string }[] = [
  ...SD_STATUS_OPTIONS,
  { value: "", label: "Not set" },
];

// How often the page re-reads the campaign while any of its emails are
// still going out (the compose modal can be closed mid-send).
const POLL_INTERVAL_MS = 4000;

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export function CampaignDetailPageClient({ campaignId }: { campaignId: number }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [view, setView] = useState<View>("leads");
  const [search, setSearch] = useState("");
  // Header filters; empty means no filter.
  const [statusFilter, setStatusFilter] = useState<CampaignLeadStatus[]>([]);
  const [sdStatusFilter, setSdStatusFilter] = useState<(SdStatus | "")[]>([]);
  const [dataPresentFilter, setDataPresentFilter] = useState<ChannelFilterChoice[]>([]);
  const [sentStatusFilter, setSentStatusFilter] = useState<ChannelFilterChoice[]>([]);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [composeFor, setComposeFor] = useState<Contact[] | null>(null);
  const [editingCampaign, setEditingCampaign] = useState(false);
  const [contactModal, setContactModal] = useState<ContactModalState>(null);
  const [pickingLeads, setPickingLeads] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<number | null>(null);

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

  // Keeps "Sending…" rows moving until the server has finished them; each
  // delivered email also turns the lead Sent, so the leads come along too.
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

  const { campaign, leads, statuses, sends } = detail;
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  // A lead deleted from the Database since is dropped from the campaign too
  // by the backend; one missing here is only a stale read, so it's skipped.
  const rows = leads.flatMap((lead) => {
    const contact = contactsById.get(lead.contactId);
    return contact ? [{ lead, contact }] : [];
  });
  const memberIds = new Set(leads.map((lead) => lead.contactId));
  const leadsNotInCampaign = contacts.filter((contact) => contact.type === "lead" && !memberIds.has(contact.id));

  const canBulkEmail = ({ lead, contact }: (typeof rows)[number]) =>
    Boolean(contact.email) &&
    !contact.emailBounceReason &&
    lead.status === "unsent" &&
    statuses.get(contact.id)?.status !== "pending";

  const visibleRows = rows
    .filter(({ lead }) => statusFilter.length === 0 || statusFilter.includes(lead.status))
    .filter(({ lead }) => sdStatusFilter.length === 0 || sdStatusFilter.includes(lead.sdStatus))
    .filter(({ contact }) => matchesChannelFilters(dataPresentFilter, contact.outreachChannels))
    .filter(({ lead }) => matchesChannelFilters(sentStatusFilter, lead.sentChannels))
    .filter(({ contact }) =>
      matchesSearch(search, [contact.name, contact.contactPerson, contact.contactRole, contact.email, contact.phone]),
    );

  const selectedRows = rows.filter((row) => canBulkEmail(row) && selectedIds.includes(row.contact.id));
  const selectableVisible = visibleRows.filter(canBulkEmail);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((row) => selectedIds.includes(row.contact.id));

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAllVisible() {
    const visibleIds = selectableVisible.map((row) => row.contact.id);
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...current, ...visibleIds.filter((id) => !current.includes(id))],
    );
  }

  function patchLead(contactId: number, patch: Partial<CampaignLead>) {
    setDetail((current) =>
      current
        ? {
            ...current,
            leads: current.leads.map((lead) => (lead.contactId === contactId ? { ...lead, ...patch } : lead)),
          }
        : current,
    );
  }

  // Applied straight away and rolled back if the backend refuses, like the
  // Database table's tick boxes.
  async function saveLead(lead: CampaignLead, patch: Partial<Pick<CampaignLead, "status" | "sdStatus" | "sentChannels">>) {
    const previous: Partial<CampaignLead> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      Object.assign(previous, { [key]: lead[key] });
    }
    setRowError(null);
    setSavingId(lead.contactId);
    patchLead(lead.contactId, patch);
    try {
      await updateCampaignLead(campaign.id, lead.contactId, patch);
    } catch (caught) {
      patchLead(lead.contactId, previous);
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  function toggleChannel(channels: OutreachChannel[], channel: OutreachChannel): OutreachChannel[] {
    return channels.includes(channel) ? channels.filter((value) => value !== channel) : [...channels, channel];
  }

  async function handleDataPresentToggle(contact: Contact, channel: OutreachChannel) {
    const previous = contact.outreachChannels;
    const next = toggleChannel(previous, channel);
    const apply = (value: OutreachChannel[]) =>
      setContacts((current) => current.map((row) => (row.id === contact.id ? { ...row, outreachChannels: value } : row)));

    setRowError(null);
    setSavingId(contact.id);
    apply(next);
    try {
      await updateDataPresent(contact.id, next);
    } catch (caught) {
      apply(previous);
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleRemove(contactId: number) {
    setRowError(null);
    setSavingId(contactId);
    try {
      await removeCampaignLead(campaign.id, contactId);
      setDetail((current) =>
        current ? { ...current, leads: current.leads.filter((lead) => lead.contactId !== contactId) } : current,
      );
      setSelectedIds((current) => current.filter((id) => id !== contactId));
      setConfirmingRemoveId(null);
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  function handleContactSaved(saved: Contact) {
    const isNew = !contactsById.has(saved.id);
    setContacts((current) => (isNew ? [saved, ...current] : current.map((row) => (row.id === saved.id ? saved : row))));
    if (isNew) {
      // The backend put it in this campaign as Unsent; shown at once rather
      // than waiting for a re-read.
      setDetail((current) =>
        current
          ? {
              ...current,
              leads: [
                { contactId: saved.id, status: "unsent", sdStatus: "", sentChannels: [], addedAt: new Date().toISOString() },
                ...current.leads,
              ],
            }
          : current,
      );
    }
    setContactModal(null);
  }

  function handleLeadsAdded(added: CampaignLead[]) {
    setDetail((current) => (current ? { ...current, leads: [...added, ...current.leads] } : current));
    setPickingLeads(false);
  }

  function handleComposeClosed(sent: boolean) {
    setComposeFor(null);
    if (!sent) return;
    setSelectedIds([]);
    setRowError(null);
    reload().catch(() => setRowError("Emails were sent, but the list couldn't refresh. Reload the page to see them."));
  }

  const sentLeads = leads.filter((lead) => lead.status === "sent").length;

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
                {option.key === "leads" && ` (${leads.length})`}
              </button>
            ))}
          </div>
          <Button type="button" variant="tertiary" onClick={() => setEditingCampaign(true)}>
            Edit campaign
          </Button>
        </div>
      </div>

      {view === "leads" && (
        <>
          <div className={`${styles.filterToggleRow} ${styles.databaseToolbar}`}>
            <TableSearchInput
              value={search}
              onChange={setSearch}
              label="Search leads"
              placeholder="Search company name, email or phone…"
            />

            <div className={styles.filterToggleRowEndGroup}>
              {selectedRows.length > 0 && (
                <button type="button" onClick={() => setSelectedIds([])} className={emailStyles.smallButton}>
                  Clear selection
                </button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={selectedRows.length === 0}
                onClick={() => setComposeFor(selectedRows.map((row) => row.contact))}
                title="Tick leads to mail them. Leads already Sent in this campaign, without an email, or whose email bounced can't be ticked."
              >
                {selectedRows.length === 0 ? "Send mail" : `Send mail to ${selectedRows.length}`}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPickingLeads(true)}>
                Add from Database
              </Button>
              <Button type="button" variant="primary" onClick={() => setContactModal({ mode: "add" })}>
                + Add new lead
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
                  <th className={`${styles.tableHeadCell} ${emailStyles.colSelect}`}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={selectableVisible.length === 0}
                      aria-label="Select all unsent leads with an email"
                      className={emailStyles.rowCheckbox}
                    />
                  </th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColSerial}`}>S.No</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Company name</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Contact person / Role</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColPhone}`}>Phone no.</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColStatus}`}>
                    <span className={styles.tableHeadControls}>
                      Status
                      <ColumnFilterDropdown
                        label="Filter by status"
                        searchable={false}
                        options={CAMPAIGN_LEAD_STATUS_OPTIONS}
                        selectedValues={statusFilter}
                        onChange={setStatusFilter}
                      />
                    </span>
                  </th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColStatus}`}>
                    <span className={styles.tableHeadControls}>
                      SD Status
                      <ColumnFilterDropdown
                        label="Filter by SD status"
                        searchable={false}
                        options={SD_STATUS_FILTER_CHOICES}
                        selectedValues={sdStatusFilter}
                        onChange={setSdStatusFilter}
                      />
                    </span>
                  </th>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colOutreach}`}>
                    <span className={styles.tableHeadControls}>
                      Data present
                      <ColumnFilterDropdown
                        label="Filter by data present"
                        searchable={false}
                        options={CHANNEL_FILTER_CHOICES}
                        selectedValues={dataPresentFilter}
                        onChange={setDataPresentFilter}
                      />
                    </span>
                  </th>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colOutreach}`}>
                    <span className={styles.tableHeadControls}>
                      Sent status
                      <ColumnFilterDropdown
                        label="Filter by sent status"
                        searchable={false}
                        options={CHANNEL_FILTER_CHOICES}
                        selectedValues={sentStatusFilter}
                        onChange={setSentStatusFilter}
                      />
                    </span>
                  </th>
                  <th className={`${styles.tableHeadCell} ${emailStyles.colCampaignStatus}`}>Last email</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseColActions}`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  const { lead, contact } = row;
                  const entry = statuses.get(contact.id);
                  const saving = savingId === contact.id;
                  return (
                    <tr
                      key={contact.id}
                      className={`${styles.tableRow} ${emailStyles.editableRow}`}
                      onDoubleClick={(event) => {
                        // Double-clicking a control in the row shouldn't open the popup.
                        if ((event.target as HTMLElement).closest("button, input, select, label, a")) return;
                        setContactModal({ mode: "edit", contact });
                      }}
                      title="Double-click to edit"
                    >
                      <td className={styles.tableCell}>
                        <input
                          type="checkbox"
                          checked={canBulkEmail(row) && selectedIds.includes(contact.id)}
                          onChange={() => toggleSelected(contact.id)}
                          disabled={!canBulkEmail(row)}
                          title={
                            !contact.email
                              ? "No email address"
                              : contact.emailBounceReason
                                ? "The last email to this address bounced. Fix the address to include it again."
                                : lead.status === "sent"
                                  ? "Already Sent in this campaign. Use the row's Resend button to send again."
                                  : undefined
                          }
                          aria-label={`Select ${contact.name}`}
                          className={emailStyles.rowCheckbox}
                        />
                      </td>
                      <td className={styles.tableCell}>{index + 1}</td>
                      <td
                        className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.databaseCellClip}`}
                        title={[contact.name, contact.email].filter(Boolean).join(" · ")}
                      >
                        {contact.name}
                        {contact.emailBounceReason && (
                          <span className={emailStyles.bouncedBadge} title={`Email bounced: ${contact.emailBounceReason}`}>
                            Bounced
                          </span>
                        )}
                      </td>
                      <td
                        className={`${styles.tableCell} ${styles.databaseCellClip}`}
                        title={[contact.contactPerson, contact.contactRole].filter(Boolean).join(" · ")}
                      >
                        {contact.contactPerson || "—"}
                        {contact.contactRole && <span className={emailStyles.contactRole}> · {contact.contactRole}</span>}
                      </td>
                      <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.phone}>
                        {contact.phone}
                      </td>
                      <td className={styles.tableCell}>
                        <StatusSelect
                          value={lead.status}
                          options={CAMPAIGN_LEAD_STATUS_OPTIONS}
                          label={`Status for ${contact.name}`}
                          disabled={saving}
                          onChange={(next) => {
                            if (next !== lead.status) void saveLead(lead, { status: next });
                          }}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <StatusSelect<SdStatus | "">
                          value={lead.sdStatus}
                          options={SD_STATUS_OPTIONS}
                          label={`SD status for ${contact.name}`}
                          disabled={saving}
                          onChange={(next) => {
                            if (next && next !== lead.sdStatus) void saveLead(lead, { sdStatus: next });
                          }}
                        />
                      </td>
                      <td className={styles.tableCell}>
                        <div className={emailStyles.outreachGroup} role="group" aria-label={`Data present for ${contact.name}`}>
                          {OUTREACH_OPTIONS.map((option) => (
                            <label key={option.value} className={emailStyles.outreachOption}>
                              <input
                                type="checkbox"
                                checked={contact.outreachChannels.includes(option.value)}
                                onChange={() => void handleDataPresentToggle(contact, option.value)}
                                disabled={saving}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className={styles.tableCell}>
                        <div className={emailStyles.outreachGroup} role="group" aria-label={`Sent status for ${contact.name}`}>
                          {OUTREACH_OPTIONS.map((option) => (
                            <label key={option.value} className={emailStyles.outreachOption}>
                              <input
                                type="checkbox"
                                checked={lead.sentChannels.includes(option.value)}
                                onChange={() =>
                                  void saveLead(lead, { sentChannels: toggleChannel(lead.sentChannels, option.value) })
                                }
                                disabled={saving}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className={styles.tableCell}>
                        <LastEmailPill entry={entry} />
                      </td>
                      <td className={styles.tableCell}>
                        {confirmingRemoveId === contact.id ? (
                          <div className={styles.deleteConfirmRow}>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemoveId(null)}
                              disabled={saving}
                              className={styles.expenseRowButton}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemove(contact.id)}
                              disabled={saving}
                              title="Takes the lead out of this campaign. It stays in the Database."
                              className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                            >
                              {saving ? "Removing…" : "Yes, remove"}
                            </button>
                          </div>
                        ) : (
                          <div className={styles.deleteConfirmRow}>
                            <button
                              type="button"
                              onClick={() => setComposeFor([contact])}
                              disabled={!contact.email || entry?.status === "pending"}
                              title={contact.email ? `Mail ${contact.email}` : "Add an email address to this lead first"}
                              className={styles.expenseRowButton}
                            >
                              {lead.status === "sent" ? "Resend" : "Send"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setContactModal({ mode: "edit", contact })}
                              className={styles.expenseRowButton}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemoveId(contact.id)}
                              className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleRows.length === 0 && (
              <p className={styles.pageSubtext}>
                {rows.length === 0
                  ? "No leads in this campaign yet. Add new ones, or bring in leads from the Database."
                  : "No leads match these filters."}
              </p>
            )}
          </div>
        </>
      )}

      {view === "summary" && (
        <>
          <div className={`${styles.statGrid} ${emailStyles.campaignStats}`}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Sent</p>
              <p className={styles.statValue}>{sentLeads}</p>
              <p className={styles.statCaption}>of {leads.length} leads in this campaign</p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Unsent</p>
              <p className={styles.statValue}>{leads.length - sentLeads}</p>
              <p className={styles.statCaption}>leads still to reach</p>
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
            {sends.length === 0 && <p className={styles.pageSubtext}>Nothing sent yet. Tick leads and press Send mail.</p>}
          </div>
        </>
      )}

      {composeFor && (
        <EmailComposeModal audience="lead" recipients={composeFor} campaignId={campaign.id} onClose={handleComposeClosed} />
      )}

      {contactModal && (
        <ContactFormModal
          // Remounts per row so the form always starts from that row's data.
          key={contactModal.mode === "edit" ? contactModal.contact.id : "add"}
          type="lead"
          typeLabel="lead"
          initialContact={contactModal.mode === "edit" ? contactModal.contact : undefined}
          campaignId={campaign.id}
          onClose={() => setContactModal(null)}
          onSaved={handleContactSaved}
        />
      )}

      {pickingLeads && (
        <CampaignAddLeadsModal
          campaignId={campaign.id}
          leads={leadsNotInCampaign}
          onClose={() => setPickingLeads(false)}
          onAdded={handleLeadsAdded}
        />
      )}

      {editingCampaign && (
        <CampaignFormModal
          initialCampaign={campaign}
          onClose={() => setEditingCampaign(false)}
          onSaved={(saved) => {
            setDetail((current) => (current ? { ...current, campaign: saved } : current));
            setEditingCampaign(false);
          }}
        />
      )}
    </>
  );
}

function LastEmailPill({ entry }: { entry: CampaignContactStatus | undefined }) {
  if (!entry) {
    return <span className={`${emailStyles.campaignStatus} ${emailStyles.campaignStatus_none}`}>None</span>;
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
