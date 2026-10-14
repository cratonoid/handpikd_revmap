// ---------------------------------------------------------------------------
// Vendor price lists for the /admin/price-lists table
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/price_lists.py. A price list is the
// vendor's original PDF, kept as-is (not rendered into page images the way a
// catalogue is) and stored privately: there is no /media URL for it, so
// viewing goes through openPriceListPdf, which fetches it with the admin's
// token. Each one belongs to a vendor and can optionally link a catalogue.
import { apiFetch } from "@/lib/api";

export type PriceList = {
  id: number;
  priceListName: string;
  vendorId: number;
  catalogueId: number | null;
  notes: string;
  originalFilename: string;
  uploadedAt: string;
};

type PriceListDetailItem = {
  id: number;
  price_list_name: string;
  vendor_id: number;
  catalogue_id: number | null;
  notes: string;
  original_filename: string;
  uploaded_at: string;
};

export async function fetchPriceLists(): Promise<PriceList[]> {
  const response = await apiFetch("/admin/get_price_list_details");
  if (!response.ok) {
    throw new Error("Failed to load price lists");
  }

  const items: PriceListDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    priceListName: item.price_list_name,
    vendorId: item.vendor_id,
    catalogueId: item.catalogue_id,
    notes: item.notes,
    originalFilename: item.original_filename,
    uploadedAt: item.uploaded_at,
  }));
}

export type PriceListCatalogueOption = {
  id: number;
  catalogueName: string;
  vendorId: number;
};

// Served by the price lists module itself rather than reusing
// fetchCatalogues, so a role with Price Lists but not Catalogues can still
// pick one to link.
export async function fetchPriceListCatalogueOptions(): Promise<PriceListCatalogueOption[]> {
  const response = await apiFetch("/admin/get_price_list_catalogue_options");
  if (!response.ok) {
    throw new Error("Failed to load catalogues");
  }

  const items: { id: number; catalogue_name: string; vendor_id: number }[] = await response.json();
  return items.map((item) => ({ id: item.id, catalogueName: item.catalogue_name, vendorId: item.vendor_id }));
}

export type SavePriceListPayload = {
  id?: number;
  priceListName: string;
  vendorId: number;
  catalogueId: number | null;
  notes: string;
  // Required when adding; on edit, only sent to replace the current PDF.
  file: File | null;
};

// Fields and PDF travel together as one multipart request, so a price list
// is never saved without its file.
export async function savePriceList(payload: SavePriceListPayload): Promise<number> {
  const formData = new FormData();
  if (payload.id !== undefined) formData.append("id", String(payload.id));
  formData.append("price_list_name", payload.priceListName);
  formData.append("vendor_id", String(payload.vendorId));
  // Omitted rather than sent empty: the backend reads a missing field as
  // "no catalogue", but an empty string would fail its int parsing.
  if (payload.catalogueId !== null) formData.append("catalogue_id", String(payload.catalogueId));
  formData.append("notes", payload.notes);
  if (payload.file) formData.append("file", payload.file);

  const response = await apiFetch(payload.id !== undefined ? "/admin/update_price_list" : "/admin/add_price_list", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).detail ?? "";
    } catch {
      // Non-JSON error body (e.g. nginx's 413 page) — fall through.
    }
    if (response.status === 413) throw new Error("That PDF is too large to upload.");
    if (detail === "file is not a PDF") throw new Error("That file isn't a PDF.");
    if (response.status === 404) throw new Error("Vendor or catalogue not found.");
    throw new Error("Something went wrong. Please try again.");
  }

  const { id }: { id: number } = await response.json();
  return id;
}

export async function deletePriceList(priceListId: number): Promise<void> {
  const response = await apiFetch("/admin/delete_price_list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: priceListId }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete price list");
  }
}

// Opens the PDF in a new tab. The tab is opened before the fetch, while the
// click still counts as a user gesture — opening it after the await is what
// popup blockers stop. The object URL is released after a minute, by which
// point the tab has long since loaded it.
export async function openPriceListPdf(priceListId: number): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const response = await apiFetch(`/admin/get_price_list_pdf?price_list_id=${priceListId}`);
    if (!response.ok) {
      throw new Error("Failed to load PDF");
    }
    const url = URL.createObjectURL(await response.blob());
    if (tab) {
      tab.location.href = url;
    } else {
      // Popup blocked anyway: fall back to a download rather than
      // navigating the admin away from the page they're on.
      const link = document.createElement("a");
      link.href = url;
      link.download = `price-list-${priceListId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
