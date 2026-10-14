// ---------------------------------------------------------------------------
// Database — the admin's address book of clients, leads and vendors
// ---------------------------------------------------------------------------
// Backed by /admin/database/* (backend/app/api/routes/database_contacts.py).
// One list for all three tabs on /admin/database, told apart by `type`.
// Name and phone are required; email is optional; vendors also carry a
// type, description and location, all optional; leads carry an optional
// contact person, a status that defaults to "new", the channels (WhatsApp /
// mail) we have their details for ("Data present"), and the channels they've
// been sent something on ("Sent status"). Optional fields come back
// as "" rather than null so they drop straight into form inputs.
import { apiFetch } from "@/lib/api";

export type ContactType = "client" | "lead" | "vendor";

export type LeadStatus = "new" | "sent";

export const LEAD_STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "sent", label: "Sent" },
];

// The Leads table's "SD Status" dropdown. Optional: "" until one is picked.
export type SdStatus = "sdi" | "sdid" | "sdl" | "sdld";

export const SD_STATUS_OPTIONS: { value: SdStatus; label: string }[] = [
  { value: "sdi", label: "SDI" },
  { value: "sdid", label: "SDID" },
  { value: "sdl", label: "SDL" },
  { value: "sdld", label: "SDLD" },
];

export type OutreachChannel = "whatsapp" | "mail";

export const OUTREACH_OPTIONS: { value: OutreachChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
];

export type Contact = {
  id: number;
  type: ContactType;
  name: string;
  email: string;
  phone: string;
  vendorType: string;
  description: string;
  location: string;
  // Lead-only; "" on client and vendor rows.
  contactPerson: string;
  // Always "new" on client and vendor rows, where it isn't shown.
  leadStatus: LeadStatus;
  // Lead-only; "" when none is set.
  sdStatus: SdStatus | "";
  // Lead-only "Data present" channels; [] on client and vendor rows.
  outreachChannels: OutreachChannel[];
  // Lead-only "Sent status" channels; [] on client and vendor rows. "mail" is
  // also ticked by the backend whenever the lead is emailed from the app.
  sentChannels: OutreachChannel[];
  // Why the last email the app sent to this address bounced; "" if it didn't.
  emailBounceReason: string;
  createdAt: string;
};

export type ContactFields = {
  name: string;
  email: string;
  phone: string;
  vendorType: string;
  description: string;
  location: string;
  contactPerson: string;
  leadStatus: LeadStatus;
  sdStatus: SdStatus | "";
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
  contact_person: string | null;
  lead_status: LeadStatus | null;
  sd_status?: SdStatus | null;
  outreach_channels?: OutreachChannel[];
  sent_channels?: OutreachChannel[];
  email_bounce_reason?: string | null;
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
    contactPerson: item.contact_person ?? "",
    leadStatus: item.lead_status ?? "new",
    sdStatus: item.sd_status ?? "",
    outreachChannels: item.outreach_channels ?? [],
    sentChannels: item.sent_channels ?? [],
    emailBounceReason: item.email_bounce_reason ?? "",
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
    contact_person: fields.contactPerson,
    lead_status: fields.leadStatus,
    sd_status: fields.sdStatus,
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

// Just the status, for the dropdown in the Leads table's Status column.
// Throws an Error with a user-facing message on failure.
export async function updateLeadStatus(id: number, status: LeadStatus): Promise<void> {
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, lead_status: status }),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't update the status. Please try again."));
  }
}

// Just the SD status, for the dropdown in the Leads table's SD Status column.
// Throws an Error with a user-facing message on failure.
export async function updateSdStatus(id: number, sdStatus: SdStatus): Promise<void> {
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, sd_status: sdStatus }),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't update the SD status. Please try again."));
  }
}

// Which of the Leads table's two tick-box columns a channel list belongs to.
export type ChannelColumn = "dataPresent" | "sentStatus";

// The full set of ticked channels for one of the Leads table's tick-box
// columns. Throws an Error with a user-facing message on failure.
export async function updateChannels(id: number, column: ChannelColumn, channels: OutreachChannel[]): Promise<void> {
  const field = column === "dataPresent" ? "outreach_channels" : "sent_channels";
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, [field]: channels }),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't update the channels. Please try again."));
  }
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
