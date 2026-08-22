// ---------------------------------------------------------------------------
// Company profile details for the admin "Profile" page
// ---------------------------------------------------------------------------
// Backed by GET/POST /admin/get_profile_details, /admin/edit_profile_details
// (backend/app/api/routes/personal_details.py), which read/write the same
// #personal_details EAV table as lib/personal-details.ts (used by the
// invoices "Company details" modal) but under the Profile page's own
// endpoint names. Converted to/from a Record<string, string> here so callers
// don't have to deal with the raw list shape.
import { apiFetch } from "@/lib/api";

type ProfileDetailsItem = { attribute: string; value: string };

export async function fetchProfileDetails(): Promise<Record<string, string>> {
  const response = await apiFetch("/admin/get_profile_details");
  if (!response.ok) {
    throw new Error("Failed to load profile details");
  }

  const items: ProfileDetailsItem[] = await response.json();
  return Object.fromEntries(items.map((item) => [item.attribute, item.value]));
}

// Partial update — only the keys present in `values` are changed.
export async function updateProfileDetails(values: Record<string, string>): Promise<Response> {
  return apiFetch("/admin/edit_profile_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
}

// GET /admin/get_backup_zip needs the Authorization bearer header, which a
// plain <a href> can't attach — same blob-and-throwaway-link approach as
// lib/invoices.ts's downloadInvoicesZip.
export async function downloadBackupZip(): Promise<void> {
  const response = await apiFetch("/admin/get_backup_zip");
  if (!response.ok) {
    throw new Error("Failed to generate backup");
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? `handpikd-backup-${new Date().toISOString().slice(0, 10)}.zip`;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
