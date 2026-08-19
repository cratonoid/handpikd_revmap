"use client";

// ---------------------------------------------------------------------------
// <DatabasePageClient> — the interactive half of /admin/database
// ---------------------------------------------------------------------------
// A single page with a tab toggle between two independent directories:
// Vendors (name/phone/address/description) and Leads (name/phone/institute
// name), each backed by its own collection in backend/app/models/database_vendor.py
// and lead.py. The Vendors table only shows name + description — the rest
// only appears once a row is opened (double-click, same "double click to
// avoid a stray edit" convention as components/admin/vendors-page-client.tsx)
// in <DatabaseVendorFormModal>, which doubles as both the "view full record"
// and the edit form. Leads has just three fields total, so its table shows
// all of them directly rather than hiding anything behind a click.
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { DatabaseVendorFormModal } from "@/components/admin/database-vendor-form-modal";
import { DatabaseLeadFormModal } from "@/components/admin/database-lead-form-modal";
import {
  fetchDatabaseVendors,
  fetchLeads,
  type DatabaseVendor,
  type Lead,
} from "@/lib/database";
import styles from "@/styles/dashboard.module.css";

type Tab = "vendors" | "leads";
type LoadState = "loading" | "loaded";
type VendorModalState = { mode: "add" } | { mode: "edit"; vendor: DatabaseVendor } | null;
type LeadModalState = { mode: "add" } | { mode: "edit"; lead: Lead } | null;

export function DatabasePageClient() {
  const [tab, setTab] = useState<Tab>("vendors");

  const [vendors, setVendors] = useState<DatabaseVendor[]>([]);
  const [vendorsLoadState, setVendorsLoadState] = useState<LoadState>("loading");
  const [vendorModalState, setVendorModalState] = useState<VendorModalState>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoadState, setLeadsLoadState] = useState<LoadState>("loading");
  const [leadModalState, setLeadModalState] = useState<LeadModalState>(null);

  // Loading state only ever transitions "loading" -> "loaded" once, on the
  // initial fetch — re-fetching after a save/delete (below) just swaps the
  // list in place without flashing back to the loading text, since the old
  // rows are still a perfectly good thing to show while the new ones load.
  function loadVendors() {
    fetchDatabaseVendors()
      .then((data) => {
        setVendors(data);
        setVendorsLoadState("loaded");
      })
      .catch(() => {
        setVendors([]);
        setVendorsLoadState("loaded");
      });
  }

  function loadLeads() {
    fetchLeads()
      .then((data) => {
        setLeads(data);
        setLeadsLoadState("loaded");
      })
      .catch(() => {
        setLeads([]);
        setLeadsLoadState("loaded");
      });
  }

  useEffect(() => {
    loadVendors();
    loadLeads();
  }, []);

  function handleVendorSaved() {
    setVendorModalState(null);
    loadVendors();
  }

  function handleVendorDeleted() {
    setVendorModalState(null);
    loadVendors();
  }

  function handleLeadSaved() {
    setLeadModalState(null);
    loadLeads();
  }

  function handleLeadDeleted() {
    setLeadModalState(null);
    loadLeads();
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Database</h1>
        </div>
        {tab === "vendors" ? (
          <Button type="button" variant="primary" onClick={() => setVendorModalState({ mode: "add" })}>
            + Add new vendor
          </Button>
        ) : (
          <Button type="button" variant="primary" onClick={() => setLeadModalState({ mode: "add" })}>
            + Add new lead
          </Button>
        )}
      </div>

      <div className={styles.filterToggleRow}>
        <div className={styles.viewToggle} role="tablist" aria-label="Database table">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "vendors"}
            onClick={() => setTab("vendors")}
            className={`${styles.viewToggleButton} ${tab === "vendors" ? styles.viewToggleButtonActive : ""}`}
          >
            Vendors
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "leads"}
            onClick={() => setTab("leads")}
            className={`${styles.viewToggleButton} ${tab === "leads" ? styles.viewToggleButtonActive : ""}`}
          >
            Leads
          </button>
        </div>
      </div>

      {tab === "vendors" ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Name</th>
                <th className={styles.tableHeadCell}>Description</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor, index) => (
                <tr
                  key={vendor.id}
                  onDoubleClick={() => setVendorModalState({ mode: "edit", vendor })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{vendor.name}</td>
                  <td className={styles.tableCell} title={vendor.description}>
                    <span className={styles.tableCellTruncate}>{vendor.description}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vendorsLoadState === "loading" && <p className={styles.pageSubtext}>Loading vendors…</p>}
          {vendorsLoadState === "loaded" && vendors.length === 0 && (
            <p className={styles.pageSubtext}>No vendors available.</p>
          )}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>S.No</th>
                <th className={styles.tableHeadCell}>Name</th>
                <th className={styles.tableHeadCell}>Phone number</th>
                <th className={styles.tableHeadCell}>Institute name</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, index) => (
                <tr
                  key={lead.id}
                  onDoubleClick={() => setLeadModalState({ mode: "edit", lead })}
                  className={styles.tableRow}
                >
                  <td className={styles.tableCell}>{index + 1}</td>
                  <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>{lead.name}</td>
                  <td className={styles.tableCell}>{lead.phone}</td>
                  <td className={styles.tableCell}>{lead.instituteName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {leadsLoadState === "loading" && <p className={styles.pageSubtext}>Loading leads…</p>}
          {leadsLoadState === "loaded" && leads.length === 0 && (
            <p className={styles.pageSubtext}>No leads available.</p>
          )}
        </div>
      )}

      {vendorModalState && (
        <DatabaseVendorFormModal
          mode={vendorModalState.mode}
          initialVendor={vendorModalState.mode === "edit" ? vendorModalState.vendor : undefined}
          onClose={() => setVendorModalState(null)}
          onSaved={handleVendorSaved}
          onDeleted={handleVendorDeleted}
        />
      )}

      {leadModalState && (
        <DatabaseLeadFormModal
          mode={leadModalState.mode}
          initialLead={leadModalState.mode === "edit" ? leadModalState.lead : undefined}
          onClose={() => setLeadModalState(null)}
          onSaved={handleLeadSaved}
          onDeleted={handleLeadDeleted}
        />
      )}
    </>
  );
}
