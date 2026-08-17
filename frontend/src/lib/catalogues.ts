// ---------------------------------------------------------------------------
// Catalogue data for the /admin/catalogues table, plus the public read
// helper for the storefront's /brand-catalogues page (further down).
// ---------------------------------------------------------------------------
// Mirrors lib/products.ts. A catalogue's images always come from converting
// an admin-uploaded PDF page-by-page (uploadCataloguePdf, backed by POST
// /admin/upload_catalogue_pdf) rather than individual image uploads/pasted
// URLs — see components/admin/catalogue-form-modal.tsx. Unlike products,
// catalogues have no is_visible/is_deleted flag: deleteCatalogue is a real,
// permanent delete (backend also removes the underlying page image files).
import { apiFetch } from "@/lib/api";

export type Catalogue = {
  id: number;
  catalogueName: string;
  catalogueVendorId: number;
  catalogueType: string;
  categoryId: string;
  imagePaths: string[];
};

type CatalogueDetailItem = {
  id: number;
  catalogue_name: string;
  catalogue_vendor_id: number;
  catalogue_type: string;
  category_id: number;
  image_paths: string[];
};

export async function fetchCatalogues(): Promise<Catalogue[]> {
  const response = await apiFetch("/admin/get_catalogue_details");
  if (!response.ok) {
    throw new Error("Failed to load catalogues");
  }

  const items: CatalogueDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    catalogueName: item.catalogue_name,
    catalogueVendorId: item.catalogue_vendor_id,
    catalogueType: item.catalogue_type,
    categoryId: String(item.category_id),
    imagePaths: item.image_paths,
  }));
}

// ---------------------------------------------------------------------------
// PDF -> page images, one page per request
// ---------------------------------------------------------------------------
// A catalogue's pages come from converting an uploaded PDF, in three steps:
// uploadCataloguePdf stages the PDF and reports its page count,
// fetchCataloguePdfPage renders one page, and discardCataloguePdfSession
// releases the staged PDF once the caller has every page it wants (see
// catalogue-form-modal.tsx's handlePdfFileChange, and
// backend/app/services/catalogue_pdf_staging.py for the staging side).
//
// The upload call used to return every rendered page at once, which real
// catalogues broke: a 107-page PDF is ~400MB of page images, well past what
// fits in one response or in the browser's memory as base64 strings.
//
// None of this writes to the catalogue's own storage — a page is only stored
// for real once Save calls addCatalogueImage for it, so a PDF that's
// converted but never saved leaves nothing behind.
export type CataloguePdfSession = {
  sessionId: string;
  pageCount: number;
};

export async function uploadCataloguePdf(file: File): Promise<CataloguePdfSession> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/upload_catalogue_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    // 413 comes from nginx, not the backend, so it has no JSON body to read
    // a detail out of (see client_max_body_size in deploy/nginx.conf) —
    // without this the size limit surfaced as a bare "Failed to convert PDF".
    if (response.status === 413) {
      throw new Error("This PDF is too large for the server to accept. Please split it into smaller files.");
    }
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Failed to convert PDF");
  }

  const { session_id: sessionId, page_count: pageCount }: { session_id: string; page_count: number } =
    await response.json();
  return { sessionId, pageCount };
}

// Renders one 0-indexed page of a staged PDF. Returns the image blob itself
// rather than a data: URI so the caller can hold it as an object URL, which
// keeps a long catalogue's pages out of JS memory.
export async function fetchCataloguePdfPage(sessionId: string, page: number): Promise<Blob> {
  const query = new URLSearchParams({ session_id: sessionId, page: String(page) });
  const response = await apiFetch(`/admin/get_catalogue_pdf_page?${query}`);

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? `Failed to convert page ${page + 1}`);
  }

  return response.blob();
}

// Releases a staged PDF as soon as the caller is done with it. The backend
// also sweeps stale staged PDFs on a TTL, so callers can fire and forget
// this — failing to send it delays cleanup, it doesn't leak forever.
export async function discardCataloguePdfSession(sessionId: string): Promise<void> {
  await apiFetch("/admin/discard_catalogue_pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

// Persists one page (a "blob:" object URL held locally since it was
// converted, never yet saved) against an already-saved catalogue via POST
// /admin/add_catalogue_image. Called once per new page during Save (see
// catalogue-form-modal.tsx's handleSubmit) rather than bundling every
// page's bytes into add/update_catalogue_details — a multi-page catalogue's
// combined bytes routinely exceeded the server's request size limit when
// this used to be one request carrying everything.
export async function addCatalogueImage(catalogueId: number, pageObjectUrl: string): Promise<string> {
  const blob = await (await fetch(pageObjectUrl)).blob();
  const formData = new FormData();
  // The filename is what the backend derives the stored file's extension
  // from (see services/storage.py) — rendered pages are JPEG.
  formData.append("catalogue_id", String(catalogueId));
  formData.append("file", blob, "page.jpg");

  const response = await apiFetch("/admin/add_catalogue_image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to save page");
  }

  const { image_path: imagePath }: { image_path: string } = await response.json();
  return imagePath;
}

// Deletes a single already-saved page image immediately (backend's
// delete_catalogue_image) rather than waiting for a full
// update_catalogue_details save — see catalogue-form-modal.tsx.
export async function deleteCatalogueImage(catalogueId: number, imagePath: string): Promise<void> {
  const response = await apiFetch("/admin/delete_catalogue_image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ catalogue_id: catalogueId, image_path: imagePath }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete image");
  }
}

// Permanently deletes a catalogue: the catalogue_details row, every
// catalogue_image_details row under it, and the underlying image files.
export async function deleteCatalogue(catalogueId: number): Promise<void> {
  const response = await apiFetch("/admin/delete_catalogue_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: catalogueId }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete catalogue");
  }
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) storefront data for the /brand-catalogues page
// ---------------------------------------------------------------------------
// Backed by GET /catalogues/get_public_catalogues, which needs no auth token
// (unlike everything above, which goes through /admin/*). Catalogues come
// back pre-grouped by catalogue_type ("brand" | "regular") and then by their
// root category — one PublicCatalogueSection per catalogue_type, matching
// the page's tab layout.
export type PublicCatalogueItem = {
  id: number;
  catalogueName: string;
  vendorName: string;
  imagePaths: string[];
};

export type PublicCatalogueCategoryGroup = {
  categoryId: number;
  categoryName: string;
  catalogues: PublicCatalogueItem[];
};

export type PublicCatalogueSection = {
  catalogueType: string;
  categories: PublicCatalogueCategoryGroup[];
};

type PublicCatalogueItemResponse = {
  id: number;
  catalogue_name: string;
  vendor_name: string;
  image_paths: string[];
};

type PublicCatalogueCategoryGroupResponse = {
  category_id: number;
  category_name: string;
  catalogues: PublicCatalogueItemResponse[];
};

type PublicCatalogueSectionResponse = {
  catalogue_type: string;
  categories: PublicCatalogueCategoryGroupResponse[];
};

export async function fetchPublicCatalogueSections(): Promise<PublicCatalogueSection[]> {
  const response = await apiFetch("/catalogues/get_public_catalogues");
  if (!response.ok) {
    throw new Error("Failed to load catalogues");
  }

  const sections: PublicCatalogueSectionResponse[] = await response.json();
  return sections.map((section) => ({
    catalogueType: section.catalogue_type,
    categories: section.categories.map((category) => ({
      categoryId: category.category_id,
      categoryName: category.category_name,
      catalogues: category.catalogues.map((item) => ({
        id: item.id,
        catalogueName: item.catalogue_name,
        vendorName: item.vendor_name,
        imagePaths: item.image_paths,
      })),
    })),
  }));
}
