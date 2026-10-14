"use client";

// ---------------------------------------------------------------------------
// <BackupsPageClient> — the interactive half of /admin/backups
// ---------------------------------------------------------------------------
// Administrator-only (see administratorOnly in lib/access.ts). A backup is
// the whole site — database, images, private documents — in one .zip. The
// server keeps one at a time, taken automatically every night (the schedule
// panel shows when); a new backup or upload replaces it
// (backend/app/services/backup.py). The page's jobs:
//   - "Download last backup" downloads that one as it is, instantly;
//   - "Back up & download" takes a fresh one on the spot and downloads it as
//     soon as it's ready, so what's downloaded is never older than the click;
//   - "Upload a backup" sends a .zip from this computer up (in chunks, see
//     lib/backups.ts), e.g. one downloaded from the old server;
//   - "Restore" on any row replaces EVERYTHING on this site with that
//     backup, after the admin types RESTORE to confirm.
//
// Backups and restores run as server-side jobs; one at a time. A running job
// is picked back up on page load (fetchActiveJob), so a reload mid-backup
// still shows its progress. A finished restore signs everybody out —
// including this admin — so its success screen is a "Sign in again" button
// rather than the usual table.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { BackupIcon, XMarkIcon } from "@/components/icons";
import { clearSession } from "@/lib/auth";
import {
  deleteBackup,
  downloadBackup,
  fetchActiveJob,
  fetchBackups,
  fetchJob,
  fetchSchedule,
  formatBytes,
  startBackup,
  startRestore,
  uploadBackup,
  type Backup,
  type BackupJob,
  type BackupSchedule,
} from "@/lib/backups";
import { formatDateTime } from "@/lib/format-date";
import styles from "@/styles/dashboard.module.css";

type LoadState = "loading" | "loaded" | "error";
type UploadState = { name: string; sent: number; total: number } | null;

const KIND_LABELS: Record<Backup["kind"], string> = {
  manual: "Backup",
  daily: "Automatic (daily)",
  pre_restore: "Automatic (before a restore)",
  uploaded: "Uploaded",
};

const POLL_INTERVAL_MS = 1000;

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const value = percent(done, total);
  return (
    <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className={styles.progressFill} style={{ width: `${value}%` }} />
    </div>
  );
}

export function BackupsPageClient() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [job, setJob] = useState<BackupJob | null>(null);
  const [upload, setUpload] = useState<UploadState>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  // The backup job whose file should download the moment it's ready ("Back
  // up & download"). A ref, so the polling effect needn't restart for it.
  const downloadWhenReady = useRef<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadBackups = useCallback(() => {
    return fetchBackups()
      .then((items) => {
        setBackups(items);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, []);

  const loadSchedule = useCallback(() => {
    fetchSchedule()
      .then(setSchedule)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadBackups();
    loadSchedule();
    void fetchActiveJob().then((active) => active && setJob(active));
  }, [loadBackups, loadSchedule]);

  // Polls the running job until it ends.
  const jobId = job?.state === "running" ? job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const timer = setInterval(() => {
      fetchJob(jobId)
        .then((latest) => {
          if (stopped) return;
          setJob(latest);
          if (latest.state !== "running") {
            const wantedDownload = downloadWhenReady.current === latest.id;
            if (wantedDownload) downloadWhenReady.current = null;
            if (latest.state === "succeeded" && latest.kind === "backup" && latest.backupName) {
              if (wantedDownload) {
                setNotice(`Backup ready: ${latest.backupName}. Your download has started.`);
                void handleDownload(latest.backupName);
              } else {
                // A job this page didn't start, e.g. the nightly one.
                setNotice(`Backup ready: ${latest.backupName}.`);
              }
            }
            if (latest.state === "failed") setError(latest.error);
            if (!(latest.kind === "restore" && latest.state === "succeeded")) {
              void loadBackups();
              loadSchedule();
            }
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, loadBackups, loadSchedule]);

  const busy = job?.state === "running" || upload !== null;
  // Newest first (see list_backups); one that can't be read isn't offered.
  const lastBackup = backups.find((item) => item.summary !== null) ?? null;
  const restoreDone = job?.kind === "restore" && job.state === "succeeded";

  async function handleBackupAndDownload() {
    setError(null);
    setNotice(null);
    try {
      const started = await startBackup();
      downloadWhenReady.current = started.id;
      setJob(started);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the backup");
    }
  }

  async function handleDownload(name: string) {
    setError(null);
    try {
      await downloadBackup(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the download");
    }
  }

  async function handleDelete(name: string) {
    setError(null);
    setConfirmingDelete(null);
    try {
      await deleteBackup(name);
      await loadBackups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the backup");
    }
  }

  async function handleUpload(file: File) {
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUpload({ name: file.name, sent: 0, total: file.size });
    try {
      const uploaded = await uploadBackup(
        file,
        (sent, total) => setUpload({ name: file.name, sent, total }),
        controller.signal,
      );
      await loadBackups();
      setNotice(`Uploaded ${file.name}. It replaced the previous backup on the server. Use Restore to load it.`);
      setRestoreTarget(uploaded);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "The upload failed");
    } finally {
      uploadAbort.current = null;
      setUpload(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRestore(target: Backup, confirm: string) {
    setError(null);
    setNotice(null);
    setRestoreTarget(null);
    try {
      setJob(await startRestore(target.name, confirm));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the restore");
    }
  }

  if (restoreDone) {
    return (
      <>
        <h1 className={styles.pageHeading}>Backup &amp; Restore</h1>
        <div className={styles.backupPanel}>
          <p className={styles.backupPanelTitle}>Restore complete</p>
          <p className={styles.pageSubtext}>
            This site now holds everything from <strong>{job.backupName}</strong>. Everyone has been signed out — sign
            in again with an account from the backup.
          </p>
          {job.safetyBackupName && (
            <p className={styles.formHint}>
              The data that was here before is saved as {job.safetyBackupName} — now the one backup on the server —
              in case you need to go back.
            </p>
          )}
          <div className={styles.backupPanelRow}>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                clearSession();
                window.location.assign("/login");
              }}
            >
              Sign in again
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.pageHeaderRow}>
        <div>
          <h1 className={styles.pageHeading}>Backup &amp; Restore</h1>
          <p className={styles.pageSubtext}>
            A backup holds everything on the site: every record, all product and catalogue images, and the private
            vendor documents. The server keeps one backup, refreshed every night. Download it to keep a copy, or
            upload one to move this site onto a new server.
          </p>
        </div>
        <div className={styles.backupHeaderActions}>
          <Button
            type="button"
            variant="tertiary"
            onClick={() => lastBackup && void handleDownload(lastBackup.name)}
            disabled={lastBackup === null}
          >
            Download last backup
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleBackupAndDownload()} disabled={busy}>
            Back up &amp; download
          </Button>
        </div>
      </div>

      {schedule && (
        <div className={styles.backupPanel}>
          <p className={styles.backupPanelTitle}>Automatic daily backup</p>
          <p className={styles.formHint}>
            {lastBackup
              ? `Last backup on the server: ${formatDateTime(lastBackup.summary?.createdAt ?? lastBackup.modifiedAt)} · ${
                  KIND_LABELS[lastBackup.kind]
                } · ${formatBytes(lastBackup.size)}. "Download last backup" downloads this one.`
              : "No backup on the server yet. \"Back up & download\" takes one now."}
          </p>
          {schedule.enabled ? (
            <>
              <p className={styles.formHint}>
                Every day at {schedule.time} (India time), replacing the previous backup.
                {schedule.nextRunAt && <> Next one: {formatDateTime(schedule.nextRunAt)}.</>}
              </p>
              {schedule.lastRunAt && schedule.lastSucceeded === false && (
                <p role="alert" className={styles.formError}>
                  The last automatic backup ({formatDateTime(schedule.lastRunAt)}) failed: {schedule.lastError}
                </p>
              )}
              <p className={styles.formHint}>
                It stays on this server, so it won&apos;t survive the server itself being lost — download a copy now
                and then to keep one safe elsewhere.
              </p>
            </>
          ) : (
            <p className={styles.formHint}>Off on this server.</p>
          )}
        </div>
      )}

      {job?.state === "running" && (
        <div className={`${styles.backupPanel} ${job.kind === "restore" ? styles.backupDangerPanel : ""}`}>
          <p className={styles.backupPanelTitle}>
            {job.kind === "restore"
              ? "Restoring — keep this page open"
              : downloadWhenReady.current === job.id
                ? "Creating a backup — it will download when ready"
                : "Creating a backup"}
          </p>
          <p className={styles.formHint}>
            {job.phase}
            {job.total > 0 && ` (${job.done.toLocaleString()} of ${job.total.toLocaleString()})`}
          </p>
          <ProgressBar done={job.done} total={job.total} />
          {job.kind === "restore" && (
            <p className={styles.formHint}>The rest of the site is unavailable until the restore finishes.</p>
          )}
        </div>
      )}

      <div className={styles.backupPanel}>
        <p className={styles.backupPanelTitle}>Upload a backup</p>
        <p className={styles.formHint}>
          Choose a backup .zip downloaded from this page — on this server or another one. It replaces the backup
          currently on the server. Large files are fine; it uploads in parts and survives a brief connection drop.
        </p>
        {upload ? (
          <>
            <p className={styles.formHint}>
              Uploading {upload.name}: {formatBytes(upload.sent)} of {formatBytes(upload.total)}
            </p>
            <ProgressBar done={upload.sent} total={upload.total} />
            <div className={styles.backupPanelRow}>
              <button type="button" className={styles.addContactButton} onClick={() => uploadAbort.current?.abort()}>
                Cancel upload
              </button>
            </div>
          </>
        ) : (
          <div className={styles.backupPanelRow}>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" aria-live="polite" className={styles.formError}>
          {error}
        </p>
      )}
      {notice && (
        <p aria-live="polite" className={styles.backupSuccess}>
          {notice}
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>Backup</th>
              <th className={styles.tableHeadCell}>Taken</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Contents</th>
              <th className={styles.tableHeadCell}>Size</th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((item) => (
              <tr key={item.name} className={styles.tableRow}>
                <td className={`${styles.tableCell} ${styles.tableCellPrimary}`}>
                  <span className={styles.tableCategoryName}>
                    <BackupIcon className="h-3.5 w-3.5" />
                    {item.name}
                  </span>
                </td>
                <td className={styles.tableCell}>
                  {formatDateTime(item.summary?.createdAt ?? item.modifiedAt)}
                </td>
                <td className={styles.tableCell}>{KIND_LABELS[item.kind]}</td>
                <td className={styles.tableCell}>
                  {item.summary
                    ? `${item.summary.documentCount.toLocaleString()} records · ${(
                        item.summary.mediaFileCount + item.summary.privateFileCount
                      ).toLocaleString()} files`
                    : item.problem}
                </td>
                <td className={styles.tableCell}>{formatBytes(item.size)}</td>
                <td className={styles.tableCell}>
                  <div className={styles.backupRowActions}>
                    <button
                      type="button"
                      className={styles.tableActionButton}
                      onClick={() => void handleDownload(item.name)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      className={styles.tableActionButton}
                      disabled={busy || item.summary === null}
                      onClick={() => setRestoreTarget(item)}
                    >
                      Restore
                    </button>
                    {confirmingDelete === item.name ? (
                      <button
                        type="button"
                        className={`${styles.tableActionButton} ${styles.tableActionButtonDanger}`}
                        disabled={busy}
                        onClick={() => void handleDelete(item.name)}
                        onBlur={() => setConfirmingDelete(null)}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.tableActionButton}
                        disabled={busy}
                        onClick={() => setConfirmingDelete(item.name)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadState === "loading" && <p className={styles.pageSubtext}>Loading backups…</p>}
        {loadState === "error" && (
          <p role="alert" className={styles.formError}>
            Failed to load backups.
          </p>
        )}
        {loadState === "loaded" && backups.length === 0 && (
          <p className={styles.pageSubtext}>No backups yet. Create one, or upload one from another server.</p>
        )}
      </div>

      {restoreTarget && (
        <RestoreConfirmModal
          backup={restoreTarget}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={(confirm) => void handleRestore(restoreTarget, confirm)}
        />
      )}
    </>
  );
}

function RestoreConfirmModal({
  backup,
  onCancel,
  onConfirm,
}: {
  backup: Backup;
  onCancel: () => void;
  onConfirm: (confirm: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const summary = backup.summary;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <div className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <h2 id="restore-title" className={styles.modalTitle}>
            Restore this backup?
          </h2>
          <button type="button" className={styles.modalCloseButton} onClick={onCancel} aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <form
          className={styles.modalForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (typed === "RESTORE") onConfirm(typed);
          }}
        >
          <div>
            <p className={styles.pageSubtext}>
              <strong>{backup.name}</strong>
              {summary?.createdAt && <> — taken {formatDateTime(summary.createdAt)}</>}
            </p>
            {summary && (
              <p className={styles.formHint}>
                {summary.documentCount.toLocaleString()} records in {summary.collectionCount} collections,{" "}
                {summary.mediaFileCount.toLocaleString()} images and {summary.privateFileCount.toLocaleString()}{" "}
                private documents.
              </p>
            )}
            <ul className={styles.backupWarningList}>
              <li>Everything on this site is replaced with what&apos;s in the backup — orders, invoices, clients, products, images, users, everything.</li>
              <li>Anything added since the backup was taken will be gone.</li>
              <li>
                A copy of the current data is saved first, so this can be undone by restoring that copy. Afterwards
                that copy is the one backup kept on the server.
              </li>
              <li>The site is unavailable while it runs, and everyone is signed out at the end.</li>
            </ul>
          </div>
          <div>
            <label htmlFor="restore-confirm" className={styles.formLabel}>
              Type RESTORE to confirm
            </label>
            <input
              id="restore-confirm"
              className={styles.formInput}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className={styles.modalActions}>
            <div className={styles.modalActionsRight}>
              <Button type="button" variant="tertiary" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={typed !== "RESTORE"}>
                Restore
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
