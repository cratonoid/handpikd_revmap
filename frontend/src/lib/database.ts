// ---------------------------------------------------------------------------
// Data for the /admin/database table (Vendors/Leads tabs)
// ---------------------------------------------------------------------------
// Mirrors lib/vendors.ts's shape but talks to the separate, simpler
// backend/app/api/routes/database.py module — this directory is unrelated to
// the richer vendors.ts/VendorDetails module (no QR codes, GST, or points of
// contact, just a flat contact list an admin can add/edit/delete).
import { apiFetch } from "@/lib/api";

export type DatabaseVendor = {
  id: number;
  name: string;
  phone: string;
  address: string;
  description: string;
};

export type Lead = {
  id: number;
  name: string;
  phone: string;
  instituteName: string;
};

type DatabaseVendorItem = {
  id: number;
  name: string;
  phone: string;
  address: string;
  description: string;
};

type LeadItem = {
  id: number;
  name: string;
  phone: string;
  institute_name: string;
};

export async function fetchDatabaseVendors(): Promise<DatabaseVendor[]> {
  const response = await apiFetch("/admin/database/get_vendors");
  if (!response.ok) {
    throw new Error("Failed to load vendors");
  }
  const items: DatabaseVendorItem[] = await response.json();
  return items;
}

export async function addDatabaseVendor(vendor: Omit<DatabaseVendor, "id">): Promise<void> {
  const response = await apiFetch("/admin/database/add_vendor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vendor),
  });
  if (!response.ok) {
    throw new Error("Failed to add vendor");
  }
}

export async function updateDatabaseVendor(vendor: DatabaseVendor): Promise<void> {
  const response = await apiFetch("/admin/database/update_vendor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vendor),
  });
  if (!response.ok) {
    throw new Error("Failed to update vendor");
  }
}

export async function deleteDatabaseVendor(id: number): Promise<void> {
  const response = await apiFetch("/admin/database/delete_vendor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete vendor");
  }
}

export async function fetchLeads(): Promise<Lead[]> {
  const response = await apiFetch("/admin/database/get_leads");
  if (!response.ok) {
    throw new Error("Failed to load leads");
  }
  const items: LeadItem[] = await response.json();
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    phone: item.phone,
    instituteName: item.institute_name,
  }));
}

export async function addLead(lead: Omit<Lead, "id">): Promise<void> {
  const response = await apiFetch("/admin/database/add_lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: lead.name, phone: lead.phone, institute_name: lead.instituteName }),
  });
  if (!response.ok) {
    throw new Error("Failed to add lead");
  }
}

export async function updateLead(lead: Lead): Promise<void> {
  const response = await apiFetch("/admin/database/update_lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      institute_name: lead.instituteName,
    }),
  });
  if (!response.ok) {
    throw new Error("Failed to update lead");
  }
}

export async function deleteLead(id: number): Promise<void> {
  const response = await apiFetch("/admin/database/delete_lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    throw new Error("Failed to delete lead");
  }
}
