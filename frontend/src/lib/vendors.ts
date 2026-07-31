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

// Uploads a vendor's QR code image and returns its decoded standard UPI
// string. Rejects (with the backend's detail message) if the image has no
// QR code, or the QR code isn't a "upi://pay?..." payment link.
export async function convertVendorQr(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/admin/convert_vendor_qr", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Failed to read QR code");
  }

  const { qr_code: qrCode }: { qr_code: string } = await response.json();
  return qrCode;
}
