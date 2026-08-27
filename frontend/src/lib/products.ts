// ---------------------------------------------------------------------------
// Product data for the /admin/products table
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts. Fetches from GET /admin/get_product_details (see
// backend/app/api/routes/products.py), which returns every product as a flat
// list — hidden and soft-deleted ones included, each carrying its flags, so
// callers filter for themselves. `id` (ProductDetails'
// Beanie primary key) is the unique key used for both the table's React key
// and matching a row back to a product for editing.
//
// ProductDetails carries two independent flags, and the /admin/products tabs
// are exactly their combinations:
//   - `isVisible`  — storefront visibility only. Off means the product is
//     hidden from /products and the public inquiry cart, but it can still be
//     quoted, ordered and invoiced. Defaults on for new products.
//   - `isDeleted`  — soft delete. The product disappears from every picker
//     (and from the storefront regardless of isVisible) but the row survives,
//     so older orders/quotations/invoices still resolve its name and HSN
//     code. Reversible via restoreProduct.
// A hard delete (deleteProduct with permanent: true) takes the row, its
// product_image_details rows and the stored image files with it, and the
// backend refuses it outright while any document still references the
// product.
//
// `imagePaths` stands in for product_image_details rows (one product has
// many). Each entry is either a pasted URL or, more commonly, the CDN URL
// returned by uploadProductImage below — either way it ends up as an
// `image_path` row keyed by `product_id` once add/update_product_details
// saves the form.
import { apiFetch } from "@/lib/api";

export type Product = {
  id: number;
  productName: string;
  hsnCode: string;
  vendorId: number;
  vendorRate: number;
  actualPrice: number;
  discountedPrice: number;
  gstPerc: number;
  categoryIds: string[];
  moq: number;
  description: string;
  isVisible: boolean;
  isDeleted: boolean;
  imagePaths: string[];
};

// Shape expected from the backend's future ProductDetailItem schema.
type ProductDetailItem = {
  id: number;
  product_name: string;
  hsn_code: string;
  vendor_id: number;
  vendor_rate: number;
  actual_price: number;
  discounted_price: number;
  gst_perc: number;
  category_ids: number[];
  moq: number;
  description: string;
  is_visible: boolean;
  is_deleted: boolean;
  image_paths: string[];
};

// Deletes a single already-saved image immediately (backend/app/api/routes/
// products.py's delete_product_image) rather than waiting for a full
// update_product_details save — see product-form-modal.tsx.
export async function deleteProductImage(productId: number, imagePath: string): Promise<void> {
  const response = await apiFetch("/admin/delete_product_image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId, image_path: imagePath }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete image");
  }
}

// Deletes a product, either way round (backend/app/api/routes/products.py's
// delete_product_details):
//   - permanent: false — flips is_deleted, fully reversible via
//     restoreProduct below, images left alone.
//   - permanent: true  — removes the product row, its image rows and the
//     image files themselves. No undo, and the backend answers 409 (with a
//     message naming what still references it, e.g. "used by 2 sales orders")
//     rather than breaking an existing document's line items.
// The 409 detail is surfaced to the admin verbatim, so it's thrown as the
// error message rather than swallowed into a generic one.
export async function deleteProduct(productId: number, permanent: boolean): Promise<void> {
  const response = await apiFetch("/admin/delete_product_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId, permanent }),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Failed to delete product");
  }
}

// Clears is_deleted (POST /admin/restore_product_details). Can still fail
// with 409 if another product has taken this one's HSN code + name pair in
// the meantime — that detail is surfaced the same way deleteProduct's is.
export async function restoreProduct(productId: number): Promise<void> {
  const response = await apiFetch("/admin/restore_product_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId }),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { detail?: string }) => body.detail)
      .catch(() => undefined);
    throw new Error(detail ?? "Failed to restore product");
  }
}

// Uploads an image file via POST /admin/upload_product_image. Nothing is
// written to disk by this call — it comes back as base64 bytes, turned into
// a data: URI the row can preview directly. The caller holds this in its
// local imagePaths list alongside any already-persisted "/media/..." paths
// or pasted URLs; a pending image only actually gets stored once Save calls
// addProductImage for it (see product-form-modal.tsx), so a file that's
// uploaded but never saved never touches the backend's disk at all.
export async function uploadProductImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/upload_product_image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to upload image");
  }

  const { data }: { data: string } = await response.json();
  // Use the original file's actual MIME type (jpg/png/webp/...) rather than
  // assuming one, since store_product_image on the backend just writes
  // whatever bytes it's given without re-encoding.
  return `data:${file.type || "application/octet-stream"};base64,${data}`;
}

// Persists one image (a data: URI held locally since uploadProductImage,
// never yet saved) against an already-saved product via POST
// /admin/add_product_image. Called once per new image during Save (see
// product-form-modal.tsx's handleSubmit) rather than bundling every image's
// bytes into add/update_product_details — see routes/catalogues.py's module
// docstring for why bundling doesn't scale.
export async function addProductImage(productId: number, dataUri: string): Promise<string> {
  const blob = await (await fetch(dataUri)).blob();
  const extension = blob.type.split("/")[1]?.split("+")[0] || "bin";
  const formData = new FormData();
  formData.append("product_id", String(productId));
  formData.append("file", blob, `image.${extension}`);

  const response = await apiFetch("/admin/add_product_image", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to save image");
  }

  const { image_path: imagePath }: { image_path: string } = await response.json();
  return imagePath;
}

// Everything add_product_details needs that an invoice line can't supply —
// see createProduct below.
export type NewProductInput = {
  productName: string;
  hsnCode: string;
  vendorId: number;
  vendorRate: number;
  actualPrice: number;
  discountedPrice: number;
  gstPerc: number;
  moq: number;
  description: string;
  // No isVisible: a product created this way is ALWAYS hidden from the
  // storefront, so there is nothing here for a caller to decide. See
  // createProduct.
};

// Creates a product outside the /admin/products form, for the purchase order
// review screen's "add it from this invoice" path (see
// purchase-order-form-modal.tsx, CreateMissingProduct). Deliberately narrower
// than that form: no images and no categories, because the only caller is
// resolving one invoice line and has neither to offer. category_ids is sent
// empty rather than guessed at — ProductDetails accepts that, and the admin
// completes the product on /admin/products afterwards, along with the
// selling prices, which the caller can only derive from what was paid.
//
// Always created HIDDEN from the storefront, and not as a default the
// caller may override — is_visible is hardcoded below and isn't a field of
// NewProductInput at all. A product born from a vendor's invoice line knows
// only what we PAID for it: its selling prices are a rule-of-thumb multiple
// of that (see sellingPricesFromCost), its name is the vendor's own wording,
// and it has no images and no categories. Publishing that to the storefront
// is never the right outcome, so the path that creates it cannot ask for it.
// The admin makes it visible on /admin/products once it has been gone over.
//
// Note this is the invoice path's guarantee, not a global rule: the ordinary
// product form posts to add_product_details directly with its own visibility
// checkbox, as it should.
//
// Returns the saved Product so the caller can drop it straight into its own
// list and select it, rather than re-fetching every product to find the one
// it just made.
export async function createProduct(input: NewProductInput): Promise<Product> {
  const response = await apiFetch("/admin/add_product_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_name: input.productName,
      hsn_code: input.hsnCode,
      vendor_id: input.vendorId,
      vendor_rate: input.vendorRate,
      actual_price: input.actualPrice,
      discounted_price: input.discountedPrice,
      gst_perc: input.gstPerc,
      category_ids: [],
      moq: input.moq,
      description: input.description,
      is_visible: false,
      image_paths: [],
    }),
  });

  if (!response.ok) {
    // add_product_details validates the prices (discounted must be below
    // actual, both above zero) and names which rule failed, so its own
    // message is shown rather than a generic one.
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string" ? body.detail : "Couldn't create this product. Please try again.",
    );
  }

  const { id }: { id: number } = await response.json();
  return {
    id,
    productName: input.productName,
    hsnCode: input.hsnCode,
    vendorId: input.vendorId,
    vendorRate: input.vendorRate,
    actualPrice: input.actualPrice,
    discountedPrice: input.discountedPrice,
    gstPerc: input.gstPerc,
    categoryIds: [],
    moq: input.moq,
    description: input.description,
    isVisible: false,
    isDeleted: false,
    imagePaths: [],
  };
}


export async function fetchProducts(): Promise<Product[]> {
  const response = await apiFetch("/admin/get_product_details");
  if (!response.ok) {
    throw new Error("Failed to load products");
  }

  const items: ProductDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    productName: item.product_name,
    hsnCode: item.hsn_code,
    vendorId: item.vendor_id,
    vendorRate: item.vendor_rate,
    actualPrice: item.actual_price,
    discountedPrice: item.discounted_price,
    gstPerc: item.gst_perc,
    categoryIds: item.category_ids.map(String),
    moq: item.moq,
    description: item.description,
    isVisible: item.is_visible,
    isDeleted: item.is_deleted,
    imagePaths: item.image_paths,
  }));
}
