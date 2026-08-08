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
