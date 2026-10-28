// ---------------------------------------------------------------------------
// Database — the admin's address book of clients, leads and vendors
// ---------------------------------------------------------------------------
// Backed by /admin/database/* (backend/app/api/routes/database_contacts.py).
// One list for all three tabs on /admin/database, told apart by `type`.
// Name and phone are required; email is optional; vendors also carry a
// type, description and location, all optional; leads carry an optional
// contact person and the channels (WhatsApp / mail) we have their details
// for ("Data present"). Optional fields come back as "" rather than null so
// they drop straight into form inputs.
//
// A lead's Status, SD Status and Sent status belong to each campaign it's in
// (lib/campaigns.ts). Here a lead is only Cold (never reached) or Warm
// (reached at least once, in any campaign).
import { apiFetch } from "@/lib/api";

export type ContactType = "client" | "lead" | "vendor";

export type LeadStatus = "new" | "sent";

export type LeadTemperature = "cold" | "warm";

export const LEAD_TEMPERATURE_OPTIONS: { value: LeadTemperature; label: string }[] = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
];

// A campaign's "SD Status" dropdown. Optional: "" until one is picked.
export type SdStatus = "sdi" | "sdl";

export const SD_STATUS_OPTIONS: { value: SdStatus; label: string }[] = [
  { value: "sdi", label: "SDI" },
  { value: "sdl", label: "SDL" },
];

export type OutreachChannel = "whatsapp" | "mail";

export const OUTREACH_OPTIONS: { value: OutreachChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
];

// The header filters on the tick-box columns of /admin/database and a
// campaign's page. A single channel matches whether or not the other one is
// ticked too; "both" and "none" are exact. Picking several matches any of
// them, and picking none is no filter.
export type ChannelFilterChoice = OutreachChannel | "both" | "none";

export const CHANNEL_FILTER_CHOICES: { value: ChannelFilterChoice; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "mail", label: "Mail" },
  { value: "both", label: "Both" },
  { value: "none", label: "None" },
];

function matchesChannelFilter(filter: ChannelFilterChoice, channels: OutreachChannel[]): boolean {
  if (filter === "both") return channels.includes("whatsapp") && channels.includes("mail");
  if (filter === "none") return channels.length === 0;
  return channels.includes(filter);
}

export function matchesChannelFilters(filters: ChannelFilterChoice[], channels: OutreachChannel[]): boolean {
  return filters.length === 0 || filters.some((filter) => matchesChannelFilter(filter, channels));
}

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
  // Lead-only: the contact person's role ("Marketing Head"); "" if not given.
  contactRole: string;
  // From before campaigns kept their own per lead: the lead's old Status
  // and Sent status, still used to tell if it was emailed from the Database
  // page. Not shown or edited any more.
  leadStatus: LeadStatus;
  sentChannels: OutreachChannel[];
  // Lead-only; "cold" on client and vendor rows, where it isn't shown.
  temperature: LeadTemperature;
  // Lead-only "Data present" channels; [] on client and vendor rows. Shared
  // by every campaign the lead is in.
  outreachChannels: OutreachChannel[];
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
  contactRole: string;
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
  contact_role?: string | null;
  lead_status: LeadStatus | null;
  temperature?: LeadTemperature | null;
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
    contactRole: item.contact_role ?? "",
    leadStatus: item.lead_status ?? "new",
    temperature: item.temperature ?? "cold",
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
    contact_role: fields.contactRole,
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

// Returns the created row. A new lead is in every campaign straight away,
// as Unsent. Throws an Error with a user-facing message.
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

// The full set of ticked "Data present" channels. Throws an Error with a
// user-facing message on failure.
export async function updateDataPresent(id: number, channels: OutreachChannel[]): Promise<void> {
  const response = await apiFetch("/admin/database/update_contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact_id: id, outreach_channels: channels }),
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
