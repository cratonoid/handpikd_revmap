"use client";

// ---------------------------------------------------------------------------
// <CampaignFormModal> — add/edit popup for a campaign
// ---------------------------------------------------------------------------
// Just a name (required) and an optional note. Opened from /admin/campaigns
// to add one, and from a campaign's own page to rename it. Saving goes
// through lib/campaigns.ts and any backend error is shown here instead of
// closing the modal.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { XMarkIcon } from "@/components/icons";
import { addCampaign, updateCampaign, type Campaign } from "@/lib/campaigns";
import styles from "@/styles/dashboard.module.css";

export function CampaignFormModal({
  initialCampaign,
  onClose,
  onSaved,
}: {
  // Present in edit mode, absent in add mode.
  initialCampaign?: Campaign;
  onClose: () => void;
  onSaved: (campaign: Campaign) => void;
}) {
  const isEdit = initialCampaign !== undefined;
  const [name, setName] = useState(initialCampaign?.name ?? "");
  const [description, setDescription] = useState(initialCampaign?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = { name: name.trim(), description: description.trim() };
    if (!fields.name) {
      setError("Enter a campaign name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = initialCampaign ? await updateCampaign(initialCampaign.id, fields) : await addCampaign(fields);
      onSaved(saved);
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
        aria-labelledby="campaign-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="campaign-modal-title" className={styles.modalTitle}>
            {isEdit ? "Edit campaign" : "New campaign"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm} noValidate>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="campaignName" className={styles.formLabel}>
                Campaign name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="campaignName"
                type="text"
                autoFocus
                required
                placeholder="e.g. Diwali 2026 hampers"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={styles.formInput}
                disabled={saving}
              />
            </div>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="campaignDescription" className={styles.formLabel}>
                Description
              </label>
              <textarea
                id="campaignDescription"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={styles.formTextarea}
                disabled={saving}
              />
            </div>
            {!isEdit && (
              <p className={`${styles.formHint} ${styles.formGridFullSpan}`}>
                Every lead, client and vendor in the Database is listed in the campaign, including ones added later.
              </p>
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
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Save changes" : "Create campaign"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
