// ---------------------------------------------------------------------------
// Whole-site backups for /admin/backups
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/backups.py; what a backup holds and how a
// restore stays safe is in backend/app/services/backup.py's header. Backups
// and restores run as server-side jobs this module polls.
//
// Three things here deliberately avoid the usual apiFetch-into-memory path,
// because a backup can be several GB:
//   - downloads go through a short-lived link the browser follows itself,
//     so the file streams straight to disk;
//   - uploads go up in chunks, each retried and resumed from wherever the
//     server says it got to;
//   - job progress is polled with a plain fetch: a restore signs everyone
//     out partway through, and apiFetch would bounce the admin to /login
//     before they saw it finish.
import { API_BASE_URL, apiFetch } from "@/lib/api";

export type BackupKind = "manual" | "daily" | "pre_restore" | "uploaded";

export type BackupSummary = {
  createdAt: string | null;
  collectionCount: number;
  documentCount: number;
  mediaFileCount: number;
  privateFileCount: number;
};

export type Backup = {
  name: string;
  kind: BackupKind;
  size: number;
  modifiedAt: string;
  summary: BackupSummary | null;
  problem: string | null;
};

export type BackupJob = {
  id: string;
  kind: "backup" | "restore";
  state: "running" | "succeeded" | "failed";
  phase: string;
  done: number;
  total: number;
  error: string | null;
  backupName: string | null;
  safetyBackupName: string | null;
};

type BackupItemResponse = {
  name: string;
  kind: BackupKind;
  size: number;
  modified_at: string;
  summary: {
    created_at: string | null;
    collection_count: number;
    document_count: number;
    media_file_count: number;
    private_file_count: number;
  } | null;
  problem: string | null;
};

type BackupJobResponse = {
  id: string;
  kind: "backup" | "restore";
  state: "running" | "succeeded" | "failed";
  phase: string;
  done: number;
  total: number;
  error: string | null;
  backup_name: string | null;
  safety_backup_name: string | null;
};

function toBackup(item: BackupItemResponse): Backup {
  return {
    name: item.name,
    kind: item.kind,
    size: item.size,
    modifiedAt: item.modified_at,
    summary: item.summary && {
      createdAt: item.summary.created_at,
      collectionCount: item.summary.collection_count,
      documentCount: item.summary.document_count,
      mediaFileCount: item.summary.media_file_count,
      privateFileCount: item.summary.private_file_count,
    },
    problem: item.problem,
  };
}

function toJob(job: BackupJobResponse): BackupJob {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    phase: job.phase,
    done: job.done,
    total: job.total,
    error: job.error,
    backupName: job.backup_name,
    safetyBackupName: job.safety_backup_name,
  };
}

// The automatic daily backup (backend/app/services/backup.py's
// daily_backup_loop). `enabled` is false on a local dev server, where
// backups are refused altogether. The last-run fields reset when the backend
// restarts.
export type BackupSchedule = {
  enabled: boolean;
  time: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSucceeded: boolean | null;
  lastError: string | null;
};

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  if (response.status === 503) {
    return new Error("The site is being restored from a backup. Try again in a few minutes.");
  }
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.detail === "string" ? body.detail : fallback);
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export async function fetchBackups(): Promise<Backup[]> {
  const response = await apiFetch("/admin/backups");
  if (!response.ok) throw await errorFrom(response, "Failed to load backups");
  const items: BackupItemResponse[] = await response.json();
  return items.map(toBackup);
}

export async function fetchSchedule(): Promise<BackupSchedule> {
  const response = await apiFetch("/admin/backups/schedule");
  if (!response.ok) throw await errorFrom(response, "Failed to load the backup schedule");
  const body: {
    enabled: boolean;
    time: string;
    next_run_at: string | null;
    last_run_at: string | null;
    last_succeeded: boolean | null;
    last_error: string | null;
  } = await response.json();
  return {
    enabled: body.enabled,
    time: body.time,
    nextRunAt: body.next_run_at,
    lastRunAt: body.last_run_at,
    lastSucceeded: body.last_succeeded,
    lastError: body.last_error,
  };
}

export async function startBackup(): Promise<BackupJob> {
  const response = await apiFetch("/admin/backups/create", { method: "POST" });
  if (!response.ok) throw await errorFrom(response, "Couldn't start the backup");
  return toJob(await response.json());
}

export async function fetchActiveJob(): Promise<BackupJob | null> {
  const response = await apiFetch("/admin/backups/jobs/active");
  if (!response.ok) return null;
  const job: BackupJobResponse | null = await response.json();
  return job && toJob(job);
}

// Plain fetch, not apiFetch — see the header.
export async function fetchJob(jobId: string): Promise<BackupJob> {
  const response = await fetch(`${API_BASE_URL}/admin/backups/jobs/${jobId}`);
  if (!response.ok) throw new Error("Lost track of the job");
  return toJob(await response.json());
}

export async function downloadBackup(name: string): Promise<void> {
  const response = await apiFetch("/admin/backups/download_link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await errorFrom(response, "Couldn't start the download");
  const { path }: { path: string } = await response.json();

  // The server sends it as an attachment, so following the link downloads
  // it in place rather than navigating away from the page.
  const link = document.createElement("a");
  link.href = `${API_BASE_URL}${path}`;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function deleteBackup(name: string): Promise<void> {
  const response = await apiFetch("/admin/backups/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await errorFrom(response, "Couldn't delete the backup");
}

const CHUNK_ATTEMPTS = 5;

// Sends `file` in the chunk size the server asks for. A failed chunk is
// retried; the server's 409 on a mismatched offset carries how much it
// really has, so a retry after a half-sent chunk resumes from there rather
// than duplicating bytes. Resolves with the stored backup once the server
// has checked it really is one.
export async function uploadBackup(
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
): Promise<Backup> {
  const startResponse = await apiFetch("/admin/backups/uploads", { method: "POST" });
  if (!startResponse.ok) throw await errorFrom(startResponse, "Couldn't start the upload");
  const { upload_id: uploadId, chunk_size: chunkSize }: { upload_id: string; chunk_size: number } =
    await startResponse.json();

  try {
    let offset = 0;
    let failures = 0;
    onProgress(0, file.size);
    while (offset < file.size) {
      if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      let response: Response;
      try {
        response = await apiFetch(`/admin/backups/uploads/${uploadId}?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        response = new Response(null, { status: 599 });
      }

      if (response.ok || response.status === 409) {
        const body: { received?: number } = await response.json().catch(() => ({}));
        if (typeof body.received === "number") {
          offset = body.received;
          failures = 0;
          onProgress(offset, file.size);
          continue;
        }
      }
      if (response.status === 404) throw await errorFrom(response, "The upload expired. Start it again.");
      failures += 1;
      if (failures >= CHUNK_ATTEMPTS) {
        throw await errorFrom(response, "The upload kept failing. Check your connection and try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
      // Ask where the server got to before resending (offset 0 never matches
      // a partly received upload, so the 409 reply carries the true count).
      const probe = await apiFetch(`/admin/backups/uploads/${uploadId}?offset=${file.size + 1}`, {
        method: "PUT",
        body: new Blob([]),
        signal,
      }).catch(() => null);
      const probeBody: { received?: number } | null = probe ? await probe.json().catch(() => null) : null;
      if (typeof probeBody?.received === "number") offset = probeBody.received;
    }

    const completeResponse = await apiFetch(`/admin/backups/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeResponse.ok) throw await errorFrom(completeResponse, "The uploaded file couldn't be read as a backup");
    return toBackup(await completeResponse.json());
  } catch (error) {
    void apiFetch(`/admin/backups/uploads/${uploadId}/cancel`, { method: "POST" }).catch(() => undefined);
    throw error;
  }
}

export async function startRestore(name: string, confirm: string): Promise<BackupJob> {
  const response = await apiFetch("/admin/backups/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, confirm }),
  });
  if (!response.ok) throw await errorFrom(response, "Couldn't start the restore");
  return toJob(await response.json());
}
