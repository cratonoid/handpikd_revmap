"use client";

// ---------------------------------------------------------------------------
// <DatabasePageClient> — the interactive half of /admin/database
// ---------------------------------------------------------------------------
// A plain address book in three tabs: Leads, Clients and Vendors. Every row
// is a name, phone and optional email; vendors also have a type, description
// and location. Backed by /admin/database/* via lib/database-contacts.ts.
//
// These rows are separate from the billing records on /admin/clients and
// /admin/vendors — no GST, no address, no link to orders — so a lead can be
// written down long before it becomes a customer.
//
// All three tabs come from one fetch, so switching between them is instant.
// Add and edit share <ContactFormModal>; delete asks once inline, the same
// way the expenses table does (accounts-expenses-tab.tsx).
//
// Leads and clients can be emailed from here: tick rows (or use a row's
// Email button) and <EmailComposeModal> sends each one their own copy.
// Double-clicking a row opens its edit popup.
//
// A lead's outreach — Status, SD Status, Sent status — is kept per campaign
// (campaign-detail-page-client.tsx). Here a lead only shows Cold or Warm
// (every Data present channel ticked in Sent status in some campaign),
// worked out by the backend, plus its "Data present" WhatsApp / Mail tick boxes, which
// every campaign shares. The Leads table filters from its headers: a funnel
// on Status and Data present (<ColumnFilterDropdown>, as on the sales
// orders' Customer column). Ticking several values in one funnel matches
// any of them; funnels combine with each other and with the search.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ContactFormModal } from "@/components/admin/contact-form-modal";
import { EmailComposeModal } from "@/components/admin/email-compose-modal";
import { ColumnFilterDropdown } from "@/components/admin/column-filter-dropdown";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import {
  CHANNEL_FILTER_CHOICES,
  deleteContact,
  fetchContacts,
  LEAD_TEMPERATURE_OPTIONS,
  matchesChannelFilters,
  OUTREACH_OPTIONS,
  updateDataPresent,
  type ChannelFilterChoice,
  type Contact,
  type ContactType,
  type LeadTemperature,
  type OutreachChannel,
} from "@/lib/database-contacts";
import { formatDate } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

type LoadState = "loading" | "loaded" | "error";
type ModalState = { mode: "add" } | { mode: "edit"; contact: Contact } | null;

const TABS: { key: ContactType; label: string; singular: string }[] = [
  { key: "lead", label: "Leads", singular: "lead" },
  { key: "client", label: "Clients", singular: "client" },
  { key: "vendor", label: "Vendors", singular: "vendor" },
];

// Backend datetimes are naive UTC.
function utc(value: string): string {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
}

export function DatabasePageClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<ContactType>("lead");
  const [search, setSearch] = useState("");
  // Leads-only header filters; empty means no filter.
  const [temperatureFilter, setTemperatureFilter] = useState<LeadTemperature[]>([]);
  const [dataPresentFilter, setDataPresentFilter] = useState<ChannelFilterChoice[]>([]);
  const [modalState, setModalState] = useState<ModalState>(null);

  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [channelsSavingId, setChannelsSavingId] = useState<number | null>(null);

  // Rows ticked for emailing, on the current tab only.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [composeFor, setComposeFor] = useState<Contact[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContacts()
      .then((rows) => {
        if (cancelled) return;
        setContacts(rows);
        setLoadState("loaded");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(caught instanceof Error ? caught.message : "Failed to load the database.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = TABS.find((option) => option.key === tab) ?? TABS[0];
  const isVendor = tab === "vendor";
  const isLead = tab === "lead";
  const nameLabel = tab === "lead" ? "Company name" : "Name";
  // The Emails module writes to leads and clients only.
  const canEmail = tab === "lead" || tab === "client";

  const visibleContacts = contacts
    .filter((contact) => contact.type === tab)
    .filter(
      (contact) =>
        !isLead ||
        ((temperatureFilter.length === 0 || temperatureFilter.includes(contact.temperature)) &&
          matchesChannelFilters(dataPresentFilter, contact.outreachChannels)),
    )
    .filter((contact) =>
      matchesSearch(search, [
        contact.name,
        contact.contactPerson,
        contact.contactRole,
        contact.email,
        contact.phone,
        contact.vendorType,
        contact.description,
        contact.location,
      ]),
    );

  // Selection may include rows the search currently hides; they still count.
  // Left out of bulk sends: addresses that bounced (until corrected), and
  // leads already emailed from here (the Database row's old Sent + Mail), so
  // a batch never repeats the same outreach. The row's own Email button still works, for
  // a deliberate follow-up or retry.
  const alreadyMailed = (contact: Contact) =>
    contact.type === "lead" && contact.leadStatus === "sent" && contact.sentChannels.includes("mail");
  const canBulkEmail = (contact: Contact) =>
    Boolean(contact.email) && !contact.emailBounceReason && !alreadyMailed(contact);
  const selectedContacts = contacts.filter(
    (contact) => contact.type === tab && canBulkEmail(contact) && selectedIds.includes(contact.id),
  );
  const selectableVisible = visibleContacts.filter(canBulkEmail);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((contact) => selectedIds.includes(contact.id));

  function switchTab(next: ContactType) {
    setTab(next);
    setConfirmingDeleteId(null);
    setRowError(null);
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

  // A lead that was emailed comes back as "sent" with Mail ticked, so the
  // rows are reloaded rather than patched by guesswork.
  function handleComposeClosed(sent: boolean) {
    setComposeFor(null);
    if (!sent) return;
    setSelectedIds([]);
    fetchContacts()
      .then(setContacts)
      .catch(() => setRowError("Emails were sent, but the list couldn't refresh. Reload the page to see the changes."));
  }

  function handleSaved(saved: Contact) {
    setContacts((current) => {
      const index = current.findIndex((row) => row.id === saved.id);
      // New rows go on top, matching the backend's newest-first order.
      if (index === -1) return [saved, ...current];
      const next = [...current];
      next[index] = saved;
      return next;
    });
    setModalState(null);
  }

  // Applied straight away and rolled back if the backend refuses, the same
  // as the expenses table's status dropdown.
  async function handleDataPresentToggle(contact: Contact, channel: OutreachChannel) {
    const previous = contact.outreachChannels;
    const next = previous.includes(channel) ? previous.filter((value) => value !== channel) : [...previous, channel];
    const apply = (value: OutreachChannel[]) =>
      setContacts((current) => current.map((row) => (row.id === contact.id ? { ...row, outreachChannels: value } : row)));

    setRowError(null);
    setChannelsSavingId(contact.id);
    apply(next);
    try {
      const saved = await updateDataPresent(contact.id, next);
      setContacts((current) => current.map((row) => (row.id === saved.id ? saved : row)));
    } catch (caught) {
      apply(previous);
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setChannelsSavingId(null);
    }
  }

  async function handleDelete(contact: Contact) {
    setRowError(null);
    setDeletingId(contact.id);
    try {
      await deleteContact(contact.id);
      setContacts((current) => current.filter((row) => row.id !== contact.id));
      setConfirmingDeleteId(null);
    } catch (caught) {
      setRowError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <h1 className={styles.pageHeading}>Database</h1>

      {/* Tabs, search, email and add share one row so the table starts
          higher; the bulk-email rules live in the button's tooltip rather
          than a sentence on a row of their own. */}
      <div className={`${styles.filterToggleRow} ${styles.databaseToolbar}`}>
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
              {option.label}
            </button>
          ))}
        </div>

        <TableSearchInput
          value={search}
          onChange={setSearch}
          label={`Search ${activeTab.label.toLowerCase()}`}
          placeholder={isVendor ? "Search name, phone, type, location…" : `Search ${nameLabel.toLowerCase()}, email or phone…`}
        />

        <div className={styles.filterToggleRowEndGroup}>
          {canEmail && selectedContacts.length > 0 && (
            <button type="button" onClick={() => setSelectedIds([])} className={emailStyles.smallButton}>
              Clear selection
            </button>
          )}
          {canEmail && (
            <Button
              type="button"
              variant="secondary"
              disabled={selectedContacts.length === 0}
              onClick={() => setComposeFor(selectedContacts)}
              title={
                `Tick ${activeTab.label.toLowerCase()} to email several at once. ` +
                (isLead
                  ? "Leads without an email, already emailed from here, or whose email bounced can't be ticked. To work leads through a campaign, use the Campaigns page."
                  : "Rows without an email, or whose email bounced, can't be ticked.")
              }
            >
              {selectedContacts.length === 0 ? "Email selected" : `Email ${selectedContacts.length} selected`}
            </Button>
          )}
          <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
            + Add new {activeTab.singular}
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
              {canEmail && (
                <th className={`${styles.tableHeadCell} ${emailStyles.colSelect}`}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={selectableVisible.length === 0}
                    aria-label={`Select all ${activeTab.label.toLowerCase()} with an email`}
                    className={emailStyles.rowCheckbox}
                  />
                </th>
              )}
              <th className={`${styles.tableHeadCell} ${styles.databaseColSerial}`}>S.No</th>
              <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>{nameLabel}</th>
              {isLead && <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Contact person / Role</th>}
              <th className={`${styles.tableHeadCell} ${styles.databaseColPhone}`}>Phone no.</th>
              {isLead && (
                <th className={`${styles.tableHeadCell} ${styles.databaseColStatus}`}>
                  <span className={styles.tableHeadControls}>
                    Status
                    <ColumnFilterDropdown
                      label="Filter by status"
                      searchable={false}
                      options={LEAD_TEMPERATURE_OPTIONS}
                      selectedValues={temperatureFilter}
                      onChange={setTemperatureFilter}
                    />
                  </span>
                </th>
              )}
              {isLead && (
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
              )}
              {isVendor && (
                <>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Type</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Location</th>
                  <th className={`${styles.tableHeadCell} ${styles.databaseCellClip}`}>Description</th>
                </>
              )}
              <th className={`${styles.tableHeadCell} ${emailStyles.colCreated}`}>Created at</th>
              <th className={`${styles.tableHeadCell} ${styles.databaseColActions}`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleContacts.map((contact, index) => (
              <tr
                key={contact.id}
                className={`${styles.tableRow} ${emailStyles.editableRow}`}
                onDoubleClick={(event) => {
                  // Double-clicking a control in the row shouldn't open the popup.
                  if ((event.target as HTMLElement).closest("button, input, select, label, a")) return;
                  setModalState({ mode: "edit", contact });
                }}
                title="Double-click to edit"
              >
                {canEmail && (
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
                            ? "The last email to this address bounced. Fix the address to include it again."
                            : alreadyMailed(contact)
                              ? "Already emailed (status Sent, Mail ticked). Use the row's Email button to follow up."
                              : undefined
                      }
                      aria-label={`Select ${contact.name}`}
                      className={emailStyles.rowCheckbox}
                    />
                  </td>
                )}
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary} ${styles.databaseCellClip}`} title={contact.name}>
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
                <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.phone}>
                  {contact.phone}
                </td>
                {isLead && (
                  <td className={styles.tableCell}>
                    <span
                      className={`${emailStyles.leadTemperature} ${emailStyles[`leadTemperature_${contact.temperature}`]}`}
                      title={
                        contact.temperature === "warm"
                          ? "Reached at least once, in a campaign or before campaigns"
                          : "Not reached yet"
                      }
                    >
                      {contact.temperature === "warm" ? "Warm" : "Cold"}
                    </span>
                  </td>
                )}
                {isLead && (
                  <td className={styles.tableCell}>
                    <div className={emailStyles.outreachGroup} role="group" aria-label={`Data present for ${contact.name}`}>
                      {OUTREACH_OPTIONS.map((option) => (
                        <label key={option.value} className={emailStyles.outreachOption}>
                          <input
                            type="checkbox"
                            checked={contact.outreachChannels.includes(option.value)}
                            onChange={() => void handleDataPresentToggle(contact, option.value)}
                            disabled={channelsSavingId === contact.id}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </td>
                )}
                {isVendor && (
                  <>
                    <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.vendorType}>
                      {contact.vendorType || "—"}
                    </td>
                    <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.location}>
                      {contact.location || "—"}
                    </td>
                    <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={contact.description}>
                      {contact.description || "—"}
                    </td>
                  </>
                )}
                <td className={styles.tableCell}>{formatDate(utc(contact.createdAt))}</td>
                <td className={styles.tableCell}>
                  {confirmingDeleteId === contact.id ? (
                    <div className={styles.deleteConfirmRow}>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={deletingId === contact.id}
                        className={styles.expenseRowButton}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(contact)}
                        disabled={deletingId === contact.id}
                        className={`${styles.expenseRowButton} ${styles.expenseRowButtonDanger}`}
                      >
                        {deletingId === contact.id ? "Deleting…" : "Yes, delete"}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.deleteConfirmRow}>
                      {canEmail && (
                        <button
                          type="button"
                          onClick={() => setComposeFor([contact])}
                          disabled={!contact.email}
                          title={contact.email ? `Email ${contact.email}` : "Add an email address to this contact first"}
                          className={styles.expenseRowButton}
                        >
                          Email
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setModalState({ mode: "edit", contact })}
                        className={styles.expenseRowButton}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(contact.id)}
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
        {loadState === "loaded" && visibleContacts.length === 0 && (
          <p className={styles.pageSubtext}>
            {contacts.some((contact) => contact.type === tab)
              ? `No ${activeTab.label.toLowerCase()} match these filters.`
              : `No ${activeTab.label.toLowerCase()} yet.`}
          </p>
        )}
      </div>

      {modalState && (
        <ContactFormModal
          // Remounts per row so the form always starts from that row's data.
          key={modalState.mode === "edit" ? modalState.contact.id : "add"}
          // The modal covers the tabs, so an edited row is always in `tab`.
          type={tab}
          typeLabel={activeTab.singular}
          initialContact={modalState.mode === "edit" ? modalState.contact : undefined}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {composeFor && canEmail && (
        <EmailComposeModal
          audience={tab === "lead" ? "lead" : "client"}
          recipients={composeFor}
          onClose={handleComposeClosed}
        />
      )}
    </>
  );
}
