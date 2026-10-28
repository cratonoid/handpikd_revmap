"use client";

// ---------------------------------------------------------------------------
// <CampaignDetailPageClient> — one campaign's page, /admin/campaigns/[id]
// ---------------------------------------------------------------------------
// Every Database lead, laid out like the Database's Leads table. Per lead,
// three columns belong to this campaign alone (lib/campaigns.ts): Status
// (Unsent / Sent), SD Status and Sent status (WhatsApp / Mail), so a lead
// Sent in one campaign is still Unsent in the next. Ticking every Data
// present channel in Sent status turns the lead Sent (and unticking one turns
// it back); the Status dropdown can still override that by hand. The rest — name, contact
// person, phone, email and Data present — is the lead's Database row
// (lib/database-contacts.ts), so editing it here changes it everywhere, and
// a lead added here with "+ Add new lead" joins the Database and so every
// campaign. Each column header has a funnel filter, as on /admin/database.
// The leads sit under two tabs, Warm and Cold, by the lead's Database
// standing: Warm once every Data present channel is ticked in Sent status in
// some campaign. The filters and search apply to both.
//
// Tick rows and "Send mail" opens <EmailComposeModal>; the send carries the
// campaign's id, and each delivered email ticks Mail in that lead's Sent
// status here (so it turns Sent if Mail was the last channel left). Bulk ticking skips leads already Sent in this campaign,
// those with no email, and addresses that bounced; a row's own button still
// sends to one of them on purpose (a follow-up or retry). The last email's
// result shows in the Last email column; the totals and the list of sends
// sit on a separate Summary view.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { CampaignFormModal } from "@/components/admin/campaign-form-modal";
import { ColumnFilterDropdown } from "@/components/admin/column-filter-dropdown";
import { ContactFormModal } from "@/components/admin/contact-form-modal";
import { EmailComposeModal } from "@/components/admin/email-compose-modal";
import { StatusSelect } from "@/components/admin/status-select";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import {
  CAMPAIGN_LEAD_STATUS_OPTIONS,
  campaignLeadFor,
  fetchCampaign,
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
  type LeadTemperature,
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

const LEAD_SECTIONS: {
  key: LeadTemperature;
  label: string;
  emptyText: string;
}[] = [
  {
    key: "warm",
    label: "Warm",
    emptyText: "No warm leads yet. A lead turns Warm once it's reached in any campaign.",
  },
  {
    key: "cold",
    label: "Cold",
    emptyText: "No cold leads. Add one with + Add new lead.",
  },
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
  const [section, setSection] = useState<LeadTemperature>("warm");
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
  const [savingId, setSavingId] = useState<number | null>(null);

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
  const rows = contacts
    .filter((contact) => contact.type === "lead")
    .map((contact) => ({ contact, lead: campaignLeadFor(leads, contact.id) }));

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

  const activeSection = LEAD_SECTIONS.find((option) => option.key === section) ?? LEAD_SECTIONS[0];
  const sectionRows = rows.filter(({ contact }) => contact.temperature === section);
  const sectionVisible = visibleRows.filter(({ contact }) => contact.temperature === section);
  const sectionCount = (key: LeadTemperature) => rows.filter(({ contact }) => contact.temperature === key).length;

  const selectedRows = sectionRows.filter((row) => canBulkEmail(row) && selectedIds.includes(row.contact.id));

  function toggleSelected(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAllSelectable(selectable: typeof rows, allSelected: boolean) {
    const ids = selectable.map((row) => row.contact.id);
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !ids.includes(id))
        : [...current, ...ids.filter((id) => !current.includes(id))],
    );
  }

  function patchLead(contactId: number, patch: Partial<CampaignLead>) {
    setDetail((current) => {
      if (!current) return current;
      const next = new Map(current.leads);
      next.set(contactId, {
        ...campaignLeadFor(current.leads, contactId),
        ...patch,
      });
      return { ...current, leads: next };
    });
  }

  // Applied straight away and rolled back if the backend refuses, like the
  // Database table's tick boxes.
  async function saveLead(
    lead: CampaignLead,
    patch: Partial<Pick<CampaignLead, "status" | "sdStatus" | "sentChannels">>,
  ) {
    const previous: Partial<CampaignLead> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      Object.assign(previous, { [key]: lead[key] });
    }
    setRowError(null);
    setSavingId(lead.contactId);
    patchLead(lead.contactId, patch);
    try {
      const saved = await updateCampaignLead(campaign.id, lead.contactId, patch);
      patchLead(lead.contactId, saved.lead);
      setContacts((current) =>
        current.map((row) => (row.id === lead.contactId ? { ...row, temperature: saved.warm ? "warm" : "cold" } : row)),
      );
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
      setContacts((current) =>
        current.map((row) => (row.id === contact.id ? { ...row, outreachChannels: value } : row)),
      );

    setRowError(null);
    setSavingId(contact.id);
    apply(next);
    try {
      const saved = await updateDataPresent(contact.id, next);
      setContacts((current) => current.map((row) => (row.id === saved.id ? saved : row)));
    } catch (caught) {
      apply(previous);
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      return;
    } finally {
      setSavingId(null);
    }
    // New channels re-run the Sent / Unsent rule on the backend.
    fetchCampaign(campaignId)
      .then(setDetail)
      .catch(() => setRowError("Saved, but the Status couldn't refresh. Reload the page to see it."));
  }

  // A new lead goes on top, matching the Database's newest-first order.
  function handleContactSaved(saved: Contact) {
    setContacts((current) =>
      current.some((row) => row.id === saved.id)
        ? current.map((row) => (row.id === saved.id ? saved : row))
        : [saved, ...current],
    );
    setContactModal(null);
  }

  function handleComposeClosed(sent: boolean) {
    setComposeFor(null);
    if (!sent) return;
    setSelectedIds([]);
    setRowError(null);
    reload().catch(() => setRowError("Emails were sent, but the list couldn't refresh. Reload the page to see them."));
  }

  function renderLeadsTable(sectionRows: typeof rows, sectionVisible: typeof rows, emptyText: string) {
    const selectableVisible = sectionVisible.filter(canBulkEmail);
    const allVisibleSelected =
      selectableVisible.length > 0 && selectableVisible.every((row) => selectedIds.includes(row.contact.id));
    return (
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.databaseTable} ${emailStyles.campaignLeadsTable}`}>
          <thead>
            <tr>
              <th className={`${styles.tableHeadCell} ${emailStyles.colSelect}`}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => toggleAllSelectable(selectableVisible, allVisibleSelected)}
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
            {sectionVisible.map((row, index) => {
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
                    <div
                      className={emailStyles.outreachGroup}
                      role="group"
                      aria-label={`Data present for ${contact.name}`}
                    >
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
                    <div
                      className={emailStyles.outreachGroup}
                      role="group"
                      aria-label={`Sent status for ${contact.name}`}
                    >
                      {OUTREACH_OPTIONS.map((option) => (
                        <label key={option.value} className={emailStyles.outreachOption}>
                          <input
                            type="checkbox"
                            checked={lead.sentChannels.includes(option.value)}
                            onChange={() =>
                              void saveLead(lead, {
                                sentChannels: toggleChannel(lead.sentChannels, option.value),
                              })
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sectionVisible.length === 0 && (
          <p className={styles.pageSubtext}>{sectionRows.length === 0 ? emptyText : "No leads match these filters."}</p>
        )}
      </div>
    );
  }

  const sentLeads = rows.filter(({ lead }) => lead.status === "sent").length;

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
                {option.key === "leads" && ` (${rows.length})`}
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

            <div className={styles.viewToggle} role="tablist" aria-label="Warm or cold leads">
              {LEAD_SECTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={section === option.key}
                  onClick={() => {
                    // Ticks don't carry across: Send mail only mails the tab in view.
                    if (option.key !== section) setSelectedIds([]);
                    setSection(option.key);
                  }}
                  className={`${styles.viewToggleButton} ${section === option.key ? styles.viewToggleButtonActive : ""}`}
                >
                  {option.label} ({sectionCount(option.key)})
                </button>
              ))}
            </div>

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

          {renderLeadsTable(sectionRows, sectionVisible, activeSection.emptyText)}
        </>
      )}

      {view === "summary" && (
        <>
          <div className={`${styles.statGrid} ${emailStyles.campaignStats}`}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Sent</p>
              <p className={styles.statValue}>{sentLeads}</p>
              <p className={styles.statCaption}>of {rows.length} leads</p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Unsent</p>
              <p className={styles.statValue}>{rows.length - sentLeads}</p>
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
                      {send.total}{" "}
                      {AUDIENCE_LABELS[send.audience][send.total === 1 ? "singular" : "plural"].toLowerCase()}
                    </td>
                    <td className={styles.tableCell}>{send.templateName || "—"}</td>
                    <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={send.subject}>
                      {send.subject}
                    </td>
                    <td className={styles.tableCell}>
                      {send.sentCount}/{send.total} sent
                      {send.failedCount > 0 && (
                        <span className={emailStyles.failedText}> · {send.failedCount} failed</span>
                      )}
                      {send.bouncedCount > 0 && (
                        <span className={emailStyles.failedText}> · {send.bouncedCount} bounced</span>
                      )}
                      {!send.done && " · sending…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sends.length === 0 && (
              <p className={styles.pageSubtext}>Nothing sent yet. Tick leads and press Send mail.</p>
            )}
          </div>
        </>
      )}

      {composeFor && (
        <EmailComposeModal
          audience="lead"
          recipients={composeFor}
          campaignId={campaign.id}
          onClose={handleComposeClosed}
        />
      )}

      {contactModal && (
        <ContactFormModal
          // Remounts per row so the form always starts from that row's data.
          key={contactModal.mode === "edit" ? contactModal.contact.id : "add"}
          type="lead"
          typeLabel="lead"
          initialContact={contactModal.mode === "edit" ? contactModal.contact : undefined}
          onClose={() => setContactModal(null)}
          onSaved={handleContactSaved}
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
