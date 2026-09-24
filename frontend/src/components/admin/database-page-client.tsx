"use client";

// ---------------------------------------------------------------------------
// <DatabasePageClient> — the interactive half of /admin/database
// ---------------------------------------------------------------------------
// A plain address book in three tabs: Clients, Leads and Vendors. Every row
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
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ContactFormModal } from "@/components/admin/contact-form-modal";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { deleteContact, fetchContacts, type Contact, type ContactType } from "@/lib/database-contacts";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";
type ModalState = { mode: "add" } | { mode: "edit"; contact: Contact } | null;

const TABS: { key: ContactType; label: string; singular: string }[] = [
  { key: "client", label: "Clients", singular: "client" },
  { key: "lead", label: "Leads", singular: "lead" },
  { key: "vendor", label: "Vendors", singular: "vendor" },
];

export function DatabasePageClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<ContactType>("client");
  const [search, setSearch] = useState("");
  const [modalState, setModalState] = useState<ModalState>(null);

  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  const visibleContacts = contacts
    .filter((contact) => contact.type === tab)
    .filter((contact) =>
      matchesSearch(search, [
        contact.name,
        contact.email,
        contact.phone,
        contact.vendorType,
        contact.description,
        contact.location,
      ]),
    );

  function switchTab(next: ContactType) {
    setTab(next);
    setConfirmingDeleteId(null);
    setRowError(null);
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
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Database</h1>
        </div>
        <Button type="button" variant="primary" onClick={() => setModalState({ mode: "add" })}>
          + Add new {activeTab.singular}
        </Button>
      </div>

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
              {option.label}
            </button>
          ))}
        </div>

        <TableSearchInput
          value={search}
          onChange={setSearch}
          label={`Search ${activeTab.label.toLowerCase()}`}
          placeholder={isVendor ? "Search name, phone, type, location…" : "Search name, email or phone…"}
        />
      </div>

      {rowError && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {rowError}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>S.No</th>
              <th className={styles.tableHeadCell}>Name</th>
              <th className={styles.tableHeadCell}>Phone no.</th>
              <th className={styles.tableHeadCell}>Email</th>
              {isVendor && (
                <>
                  <th className={styles.tableHeadCell}>Type</th>
                  <th className={styles.tableHeadCell}>Location</th>
                  <th className={styles.tableHeadCell}>Description</th>
                </>
              )}
              <th className={styles.tableHeadCell}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleContacts.map((contact, index) => (
              <tr key={contact.id} className={styles.tableRow}>
                <td className={styles.tableCell}>{index + 1}</td>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{contact.name}</td>
                <td className={styles.tableCell}>{contact.phone}</td>
                <td className={styles.tableCell}>{contact.email || "—"}</td>
                {isVendor && (
                  <>
                    <td className={styles.tableCell}>{contact.vendorType || "—"}</td>
                    <td className={styles.tableCell}>{contact.location || "—"}</td>
                    <td className={styles.tableCell} title={contact.description}>
                      <span className={styles.tableCellTruncate}>{contact.description || "—"}</span>
                    </td>
                  </>
                )}
                <td className={styles.tableCell}>
                  {confirmingDeleteId === contact.id ? (
                    <div className={styles.deleteConfirmRow}>
                      <span className={styles.deleteConfirmText}>Delete?</span>
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
            {search ? `No ${activeTab.label.toLowerCase()} match your search.` : `No ${activeTab.label.toLowerCase()} yet.`}
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
    </>
  );
}
