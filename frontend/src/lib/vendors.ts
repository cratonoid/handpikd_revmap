// ---------------------------------------------------------------------------
// Vendor data for the /admin/vendors table
// ---------------------------------------------------------------------------
// Mirrors lib/customers.ts. Fetches from GET /admin/get_vendor_details
// (not yet implemented on the backend — see backend/app/models/vendor_details.py
// and vendor_poc_details.py for the underlying collections), which is expected
// to return every vendor as a flat list. `id` (VendorDetails' Beanie primary
// key) is the unique key used for both the table's React key and matching a
// row back to a vendor for editing — unlike customers, vendors have no email
// to key off of.
//
// `qrCode` is the vendor's standard UPI deep-link string (e.g.
// "upi://pay?pa=vendor@upibank&pn=Vendor&..."), decoded from an uploaded QR
// code image via POST /admin/convert_vendor_qr (see convertVendorQr below).
import { apiFetch } from "@/lib/api";

export type VendorPoc = {
  name: string;
  phone: string;
};

export type Vendor = {
  id: number;
  registeredName: string;
  gst: string;
  address: string;
  description: string;
  qrCode: string;
  isDeleted: boolean;
  pocs: VendorPoc[];
};

// Shape expected from the backend's future VendorDetailItem schema —
// mirrors CustomerDetailItem's contact_name/contact_phone array pairing.
type VendorDetailItem = {
  id: number;
  registered_name: string;
  gst: string;
  address: string;
  description: string;
  qr_code: string;
  is_deleted: boolean;
  contact_name: string[];
  contact_phone: string[];
};

export type VendorOption = {
  id: number;
  name: string;
  // "" if the vendor has no GST number on file — see product-form-modal.tsx,
  // which filters these down to GST-only for its vendor picker.
  gst: string;
};

type VendorListItem = {
  vendor_id: number;
  vendor_name: string;
  gst: string;
};

// Lightweight id+name list for vendor-picker dropdowns (product and purchase
// order popups) — GET /admin/get_vendors_list only returns active vendors,
// unlike fetchVendors's full get_vendor_details.
export async function fetchVendorsList(): Promise<VendorOption[]> {
  const response = await apiFetch("/admin/get_vendors_list");
  if (!response.ok) {
    throw new Error("Failed to load vendors");
  }

  const items: VendorListItem[] = await response.json();
  return items.map((item) => ({ id: item.vendor_id, name: item.vendor_name, gst: item.gst }));
}

export async function fetchVendors(): Promise<Vendor[]> {
  const response = await apiFetch("/admin/get_vendor_details");
  if (!response.ok) {
    throw new Error("Failed to load vendors");
  }

  const items: VendorDetailItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    registeredName: item.registered_name,
    gst: item.gst,
    address: item.address,
    description: item.description,
    qrCode: item.qr_code,
    isDeleted: item.is_deleted,
    pocs: item.contact_name.map((name, index) => ({
      name,
      phone: item.contact_phone[index] ?? "",
    })),
  }));
}

export type ConvertedQr = {
  qrCode: string;
  // "QR code added" / "QR code updated" — depends on whether `vendorId`
  // already had a qr_code set, so it's only meaningful when a vendorId was
  // passed (i.e. editing an existing vendor).
  message: string;
};

// Uploads a vendor's QR code image and returns its decoded standard UPI
// string. Rejects (with the backend's detail message) if the image has no
// QR code, or the QR code isn't a "upi://pay?..." payment link. `vendorId`
// is only passed in "edit" mode — see convert_vendor_qr in
// backend/app/api/routes/vendors.py for how it's used to pick the message.
export async function convertVendorQr(file: File, vendorId?: number): Promise<ConvertedQr> {
  const formData = new FormData();
  formData.append("file", file);
  if (vendorId !== undefined) {
    formData.append("vendor_id", String(vendorId));
  }

  const response = await apiFetch("/admin/convert_vendor_qr", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Failed to read QR code");
  }

  const { qr_code: qrCode, message }: { qr_code: string; message: string } = await response.json();
  return { qrCode, message };
}
