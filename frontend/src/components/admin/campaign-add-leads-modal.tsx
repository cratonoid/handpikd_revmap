"use client";

// ---------------------------------------------------------------------------
// <CampaignAddLeadsModal> — pick Database leads to put in a campaign
// ---------------------------------------------------------------------------
// Opened from a campaign's page (campaign-detail-page-client.tsx). Lists the
// Database leads that aren't in the campaign yet, with their Cold / Warm
// standing, a search, and a tick box each. "Add" puts the ticked ones in as
// Unsent through addCampaignLeads (lib/campaigns.ts).
import { useState } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { matchesSearch, TableSearchInput } from "@/components/admin/table-search-input";
import { addCampaignLeads, type CampaignLead } from "@/lib/campaigns";
import type { Contact } from "@/lib/database-contacts";
import styles from "@/styles/dashboard.module.css";
import emailStyles from "@/styles/emails.module.css";

export function CampaignAddLeadsModal({
  campaignId,
  leads,
  onClose,
  onAdded,
}: {
  campaignId: number;
  // Leads not in the campaign yet, newest first.
  leads: Contact[];
  onClose: () => void;
  onAdded: (rows: CampaignLead[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = leads.filter((lead) =>
    matchesSearch(search, [lead.name, lead.contactPerson, lead.contactRole, lead.email, lead.phone]),
  );
  const allVisibleSelected = visible.length > 0 && visible.every((lead) => selectedIds.includes(lead.id));

  function toggle(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAllVisible() {
    const visibleIds = visible.map((lead) => lead.id);
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...current, ...visibleIds.filter((id) => !current.includes(id))],
    );
  }

  async function handleAdd() {
    setSaving(true);
    setError(null);
    try {
      onAdded(await addCampaignLeads(campaignId, selectedIds));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-add-leads-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="campaign-add-leads-title" className={styles.modalTitle}>
            Add leads from the Database
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className={styles.modalForm}>
          <TableSearchInput
            value={search}
            onChange={setSearch}
            label="Search leads"
            placeholder="Search company name, email or phone…"
          />

          <div className={emailStyles.leadPickList}>
            {leads.length === 0 ? (
              <p className={styles.pageSubtext}>Every lead in the Database is already in this campaign.</p>
            ) : visible.length === 0 ? (
              <p className={styles.pageSubtext}>No leads match.</p>
            ) : (
              <>
                <label className={`${emailStyles.leadPickRow} ${emailStyles.leadPickRowAll}`}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={saving} />
                  Select all{search.trim() && " (filtered)"}
                </label>
                {visible.map((lead) => (
                  <label key={lead.id} className={emailStyles.leadPickRow}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(lead.id)}
                      onChange={() => toggle(lead.id)}
                      disabled={saving}
                    />
                    <span className={emailStyles.leadPickName}>
                      {lead.name}
                      {lead.contactPerson && <span className={emailStyles.contactRole}> · {lead.contactPerson}</span>}
                    </span>
                    <span className={`${emailStyles.leadTemperature} ${emailStyles[`leadTemperature_${lead.temperature}`]}`}>
                      {lead.temperature === "warm" ? "Warm" : "Cold"}
                    </span>
                  </label>
                ))}
              </>
            )}
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => void handleAdd()} disabled={saving || selectedIds.length === 0}>
                {saving ? "Adding…" : selectedIds.length === 0 ? "Add leads" : `Add ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
