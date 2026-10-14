// ---------------------------------------------------------------------------
// Vendor price lists for the /admin/price-lists table
// ---------------------------------------------------------------------------
// Backed by backend/app/api/routes/price_lists.py. A price list is the
// vendor's original file — a PDF or an Excel workbook (.xlsx / .xls) — kept
// as-is (not rendered into page images the way a catalogue is) and stored
// privately: there is no /media URL for it, so it's fetched with the admin's
// token. A PDF opens in a new tab (openPriceListFile); a workbook is shown
// in the admin as a table (fetchPriceListSheets), with openPriceListFile
// downloading the original. Each one belongs to a vendor and can optionally
// link a catalogue.
import { apiFetch } from "@/lib/api";

export type PriceListFileType = "pdf" | "xlsx" | "xls";

// For <input accept>: extensions plus media types, since browsers differ on
// which of the two they match Excel files by.
export const PRICE_LIST_FILE_ACCEPT = [
  ".pdf",
  ".xlsx",
  ".xls",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
].join(",");

export function isExcelFileType(fileType: PriceListFileType): boolean {
  return fileType === "xlsx" || fileType === "xls";
}

export type PriceList = {
  id: number;
  priceListName: string;
  vendorId: number;
  catalogueId: number | null;
  notes: string;
  fileType: PriceListFileType;
  originalFilename: string;
  uploadedAt: string;
};

type PriceListDetailItem = {
  id: number;
  price_list_name: string;
  vendor_id: number;
  catalogue_id: number | null;
  notes: string;
  file_type: PriceListFileType;
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
    fileType: item.file_type,
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
  // Required when adding; on edit, only sent to replace the current file.
  file: File | null;
};

// Fields and file travel together as one multipart request, so a price list
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
    if (response.status === 413) throw new Error("That file is too large to upload.");
    if (detail === "file must be a PDF or an Excel workbook") {
      throw new Error("That file isn't a PDF or an Excel workbook (.xlsx / .xls).");
    }
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

// An Excel price list read server-side into text cells, one entry per
// visible worksheet — what <PriceListSheetViewer> renders, since a browser
// can't open a workbook itself. `truncated` means the sheet ran past the
// viewer's row/column limit and the rest is only in the downloaded file.
export type PriceListSheet = {
  name: string;
  rows: string[][];
  truncated: boolean;
};

export async function fetchPriceListSheets(priceListId: number): Promise<PriceListSheet[]> {
  const response = await apiFetch(`/admin/get_price_list_sheets?price_list_id=${priceListId}`);
  if (!response.ok) {
    throw new Error("Failed to read workbook");
  }
  const data: { sheets: PriceListSheet[] } = await response.json();
  return data.sheets;
}

function downloadObjectUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// A PDF opens in a new tab; a workbook downloads (named after the price
// list) for Excel to open — viewing one in the admin goes through
// fetchPriceListSheets instead. For a PDF the
// tab is opened before the fetch, while the click still counts as a user
// gesture — opening it after the await is what popup blockers stop. The
// object URL is released after a minute, by which point the tab or download
// has long since read it.
export async function openPriceListFile(priceList: PriceList): Promise<void> {
  const filename = `${priceList.priceListName}.${priceList.fileType}`;
  const tab = isExcelFileType(priceList.fileType) ? null : window.open("", "_blank");
  try {
    const response = await apiFetch(`/admin/get_price_list_file?price_list_id=${priceList.id}`);
    if (!response.ok) {
      throw new Error("Failed to load file");
    }
    const url = URL.createObjectURL(await response.blob());
    if (tab) {
      tab.location.href = url;
    } else {
      // An Excel file, or a PDF whose tab was blocked anyway: download it
      // rather than navigating the admin away from the page they're on.
      downloadObjectUrl(url, filename);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
