// ---------------------------------------------------------------------------
// Database — the admin's address book of clients, leads and vendors
// ---------------------------------------------------------------------------
// Backed by /admin/database/* (backend/app/api/routes/database_contacts.py).
// One list for all three tabs on /admin/database, told apart by `type`.
// Name and phone are required; email is optional; vendors also carry a
// type, description and location, all optional. Optional fields come back
// as "" rather than null so they drop straight into form inputs.
import { apiFetch } from "@/lib/api";

export type ContactType = "client" | "lead" | "vendor";

export type Contact = {
  id: number;
  type: ContactType;
  name: string;
  email: string;
  phone: string;
  vendorType: string;
  description: string;
  location: string;
  createdAt: string;
};

export type ContactFields = {
  name: string;
  email: string;
  phone: string;
  vendorType: string;
  description: string;
  location: string;
};

// Shape returned by the backend's ContactItem schema.
type ContactItemResponse = {
  contact_id: number;
  contact_type: ContactType;
  name: string;
  email: string | null;
  phone: string;
  vendor_type: string | null;
  description: string | null;
  location: string | null;
  created_at: string;
};

function toContact(item: ContactItemResponse): Contact {
  return {
    id: item.contact_id,
    type: item.contact_type,
    name: item.name,
    email: item.email ?? "",
    phone: item.phone,
    vendorType: item.vendor_type ?? "",
    description: item.description ?? "",
    location: item.location ?? "",
    createdAt: item.created_at,
  };
}

// "" is sent as-is: on an update the backend reads it as "clear this field".
function toRequestFields(fields: ContactFields) {
  return {
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    vendor_type: fields.vendorType,
    description: fields.description,
    location: fields.location,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

// Every contact of every type, newest first. Fetched whole so switching
// tabs is instant rather than a request per tab.
export async function fetchContacts(): Promise<Contact[]> {
  const response = await apiFetch("/admin/database/get_contacts");
  if (!response.ok) {
    throw new Error("Failed to load the database.");
  }
  const items: ContactItemResponse[] = await response.json();
  return items.map(toContact);
}

// Returns the created row. Throws an Error with a user-facing message.
export async function addContact(type: ContactType, fields: ContactFields): Promise<Contact> {
  const response = await apiFetch("/admin/database/add_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_type: type, ...toRequestFields(fields) }),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Something went wrong. Please try again."));
  }
  const body: { contact: ContactItemResponse } = await response.json();
  return toContact(body.contact);
}

// Returns the updated row. Throws an Error with a user-facing message.
export async function updateContact(id: number, fields: ContactFields): Promise<Contact> {
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, ...toRequestFields(fields) }),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Something went wrong. Please try again."));
  }
  const body: { contact: ContactItemResponse } = await response.json();
  return toContact(body.contact);
}

// Throws an Error with a user-facing message on failure.
export async function deleteContact(id: number): Promise<void> {
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, delete: true }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Contact not found.");
    }
    throw new Error("Something went wrong. Please try again.");
  }
}
