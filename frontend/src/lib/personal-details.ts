// ---------------------------------------------------------------------------
// Personal (seller/company) details for the invoices "Company details" modal
// ---------------------------------------------------------------------------
// Backed by GET/POST /admin/get_personal_details, /admin/update_personal_details
// (backend/app/api/routes/personal_details.py), which store/return the
// #personal_details EAV table as a flat {attribute, value}[] list rather than
// named fields (see backend/app/services/personal_details.py for the fixed
// attribute set). Converted to/from a Record<string, string> here so callers
// don't have to deal with the raw list shape.
import { apiFetch } from "@/lib/api";

type PersonalDetailsItem = { attribute: string; value: string };

export async function fetchPersonalDetails(): Promise<Record<string, string>> {
  const response = await apiFetch("/admin/get_personal_details");
  if (!response.ok) {
    throw new Error("Failed to load company details");
  }

  const items: PersonalDetailsItem[] = await response.json();
  return Object.fromEntries(items.map((item) => [item.attribute, item.value]));
}

// Partial update — only the keys present in `values` are changed, so a form
// editing invoice-related attributes doesn't need to round-trip
// quotation_tnc/quotation_notes (owned by the quotations module) and vice
// versa.
export async function updatePersonalDetails(values: Record<string, string>): Promise<Response> {
  return apiFetch("/admin/update_personal_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
}

// Uploads the company's signature scan via POST /admin/upload_signature_image
// (backend/app/services/storage.py) and returns its served /media URL. Same
// two-step flow as lib/products.ts's uploadProductImage: this only stores the
// file and hands back its path -- the caller still has to save it into the
// "signature_image" personal_details attribute via updatePersonalDetails.
export async function uploadSignatureImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/upload_signature_image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to upload signature image");
  }

  const { url }: { url: string } = await response.json();
  return url;
}
