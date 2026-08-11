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

// Converts an uploaded PDF into one image per page, in page order, via POST
// /admin/upload_catalogue_pdf (backend/app/services/pdf.py renders each
// page). Nothing is written to disk by this call — each page comes back as
// base64 PNG bytes, turned into a data: URI the grid can render directly.
// The caller holds these in its local imagePaths list alongside any
// already-persisted "/media/..." paths; a page only actually gets stored
// once Save calls addCatalogueImage for it (see catalogue-form-modal.tsx),
// so a page that's uploaded but never saved never touches the backend's
// disk at all.
export async function uploadCataloguePdf(file: File): Promise<string[]> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/upload_catalogue_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Failed to convert PDF");
  }

  const { page_images: pageImages }: { page_images: string[] } = await response.json();
  return pageImages.map((base64) => `data:image/png;base64,${base64}`);
}

// Persists one page (a data: URI held locally since uploadCataloguePdf,
// never yet saved) against an already-saved catalogue via POST
// /admin/add_catalogue_image. Called once per new page during Save (see
// catalogue-form-modal.tsx's handleSubmit) rather than bundling every
// page's bytes into add/update_catalogue_details — a multi-page catalogue's
// combined bytes routinely exceeded the server's request size limit when
// this used to be one request carrying everything.
export async function addCatalogueImage(catalogueId: number, dataUri: string): Promise<string> {
  const blob = await (await fetch(dataUri)).blob();
  const formData = new FormData();
  formData.append("catalogue_id", String(catalogueId));
  formData.append("file", blob, "page.png");

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
