// ---------------------------------------------------------------------------
// Product data for the /admin/products table
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts. Fetches from GET /admin/get_product_details (not
// yet implemented on the backend — see backend/app/models/product_details.py
// and product_image_details.py for the underlying collections), which is
// expected to return every product as a flat list. `id` (ProductDetails'
// Beanie primary key) is the unique key used for both the table's React key
// and matching a row back to a product for editing.
//
// There's no `is_deleted` field on ProductDetails, only `is_visible` — the
// admin UI's delete/restore action (product-form-modal.tsx) reuses that flag
// the same way vendors/customers reuse `is_deleted`: a soft toggle, not a
// real removal.
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
    imagePaths: item.image_paths,
  }));
}
