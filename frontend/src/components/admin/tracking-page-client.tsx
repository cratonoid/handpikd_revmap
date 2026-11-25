"use client";

// ---------------------------------------------------------------------------
// <TrackingPageClient> — /admin/tracking
// ---------------------------------------------------------------------------
// Paste a Porter tracking link; get back a /track/<id> link for the
// customer, which shows the delivery's progress without the pickup address
// or anything about us (lib/tracking.ts). Links stop updating once the
// delivery ends and expire after 24 hours; they can also be deactivated or
// deleted here.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { formatDateTime } from "@/lib/format-date";
import {
  createTrackingLink,
  customerLink,
  deactivateTrackingLink,
  deleteTrackingLink,
  fetchTrackingLinks,
  isPorterTrackingUrl,
  trackStatusLabel,
  type TrackingLink,
  type TrackingState,
} from "@/lib/tracking";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "failed";

const STATE_LABEL: Record<TrackingState, string> = {
  active: "Live",
  finished: "Ended",
  deactivated: "Expired",
};

const STATE_COLOR: Record<TrackingState, string> = {
  active: styles.statusProcessing,
  finished: styles.statusCompleted,
  deactivated: styles.statusCancelled,
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? "Copied ✓" : "Copy link"}
    </Button>
  );
}

export function TrackingPageClient() {
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [porterUrl, setPorterUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TrackingLink | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks(await fetchTrackingLinks());
      setLoadState("loaded");
    } catch {
      setLoadState("failed");
    }
  }, []);

  // Refreshed every 30 seconds so statuses stay current while the page is open.
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPorterTrackingUrl(porterUrl)) {
      return setError("That isn't a Porter tracking link. Paste the porter.in/rd/… link Porter sent.");
    }
    setSaving(true);
    setError(null);
    try {
      const link = await createTrackingLink(porterUrl, label);
      setCreated(link);
      setLinks((previous) => [link, ...previous]);
      setPorterUrl("");
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: "deactivate" | "delete") {
    if (action === "delete" && !window.confirm("Delete this tracking link? The customer's link stops working.")) return;
    setBusyId(id);
    try {
      if (action === "delete") {
        await deleteTrackingLink(id);
        setLinks((previous) => previous.filter((link) => link.id !== id));
        if (created?.id === id) setCreated(null);
      } else {
        const saved = await deactivateTrackingLink(id);
        setLinks((previous) => previous.map((link) => (link.id === id ? saved : link)));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className={styles.pageHeaderWithTabs}>
        <h1 className={styles.pageHeading}>Tracking</h1>
      </div>
      <p className={styles.pageSubtext}>
        Paste a Porter tracking link to get a private link for your customer. It shows the driver, ETA and drop point,
        never the pickup address or your details. It stops updating once delivered and expires after 24 hours.
      </p>

      <form onSubmit={handleSubmit} noValidate className={styles.formGrid}>
        <div className={styles.formGridFullSpan}>
          <label htmlFor="porterUrl" className={styles.formLabel}>
            Porter tracking link<span className={styles.requiredMark}>*</span>
          </label>
          <input
            id="porterUrl"
            type="url"
            inputMode="url"
            placeholder="https://porter.in/rd/…"
            value={porterUrl}
            onChange={(event) => setPorterUrl(event.target.value)}
            className={styles.formInput}
            disabled={saving}
          />
        </div>
        <div>
          <label htmlFor="trackingLabel" className={styles.formLabel}>
            Note (only you see it)
          </label>
          <input
            id="trackingLabel"
            type="text"
            maxLength={100}
            placeholder="e.g. Customer name, 40 hampers"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className={styles.formInput}
            disabled={saving}
          />
        </div>
        <div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Creating…" : "Create customer link"}
          </Button>
        </div>
        {error && (
          <p role="alert" aria-live="polite" className={`${styles.formGridFullSpan} ${styles.formError}`}>
            {error}
          </p>
        )}
      </form>

      {created && (
        <div className={styles.formGrid}>
          <div className={styles.formGridFullSpan}>
            <label htmlFor="createdLink" className={styles.formLabel}>
              Customer link{created.status ? ` · ${trackStatusLabel(created.status)}` : ""}
            </label>
            <input id="createdLink" type="text" readOnly value={customerLink(created.id)} className={styles.formInput} />
            {created.lastError && (
              <p className={styles.formHint}>
                Couldn&apos;t read Porter yet ({created.lastError}). It keeps trying every 20 seconds.
              </p>
            )}
          </div>
          <div>
            <CopyButton text={customerLink(created.id)} />
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Created</th>
              <th className={styles.tableHeadCell}>Note</th>
              <th className={styles.tableHeadCell}>Link</th>
              <th className={styles.tableHeadCell}>Delivery</th>
              <th className={styles.tableHeadCell}>Last update</th>
              <th className={styles.tableHeadCell} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <td className={styles.tableCell}>{formatDateTime(link.createdAt)}</td>
                <td className={`${styles.tableCell} ${styles.databaseCellClip}`} title={link.porterUrl}>
                  {link.label || "—"}
                </td>
                <td className={`${styles.tableCell} ${styles.statusText} ${STATE_COLOR[link.state]}`}>
                  {STATE_LABEL[link.state]}
                </td>
                <td className={styles.tableCell}>
                  {link.status ? trackStatusLabel(link.status) : "—"}
                  {link.lastError && link.state === "active" && (
                    <span className={styles.formHint} title={link.lastError}>
                      {" "}
                      · retrying
                    </span>
                  )}
                </td>
                <td className={styles.tableCell}>{link.lastUpdated ? formatDateTime(link.lastUpdated) : "—"}</td>
                <td className={styles.tableCell}>
                  <div className={styles.pageHeaderActions}>
                    {link.state !== "deactivated" && <CopyButton text={customerLink(link.id)} />}
                    {link.state !== "deactivated" && (
                      <button
                        type="button"
                        onClick={() => void act(link.id, "deactivate")}
                        disabled={busyId === link.id}
                        className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                      >
                        Deactivate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void act(link.id, "delete")}
                      disabled={busyId === link.id}
                      className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading tracking links…</p>}
        {loadState === "failed" && (
          <p role="alert" className={styles.formError}>
            Couldn&apos;t load tracking links. Please refresh the page or try again shortly.
          </p>
        )}
        {loadState === "loaded" && links.length === 0 && (
          <p className={styles.pageSubtext}>No tracking links yet. Paste a Porter link above.</p>
        )}
      </div>
    </>
  );
}
