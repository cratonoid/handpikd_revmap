// ---------------------------------------------------------------------------
// Campaigns — named outreach to every Database lead
// ---------------------------------------------------------------------------
// Backed by /admin/campaign/* (backend/app/api/routes/campaigns.py). Every
// lead in /admin/database (lib/database-contacts.ts) is in every campaign,
// and each campaign keeps the lead's Status (Unsent / Sent), SD Status and
// Sent status for itself. The lead's details and Data present
// are the Database row's, shared with every campaign. Mail goes out through
// the Emails module's sendEmail() with the campaign's id attached, which
// ticks Mail in the lead's Sent status here. A lead turns Sent once every
// Data present channel is ticked in its Sent status (the backend applies
// the rule on each tick change; the Status can still be changed by hand); the delivery results come back
// from fetchCampaign(), worked out on the server from those sends.
import { apiFetch } from "@/lib/api";
import type { OutreachChannel, SdStatus } from "@/lib/database-contacts";
import { toSend, type EmailSend, type RecipientStatus, type SendItemResponse } from "@/lib/emails";

export type CampaignLeadStatus = "unsent" | "sent";

export const CAMPAIGN_LEAD_STATUS_OPTIONS: { value: CampaignLeadStatus; label: string }[] = [
  { value: "unsent", label: "Unsent" },
  { value: "sent", label: "Sent" },
];

// One lead's standing in a campaign: only the parts that are this
// campaign's own. Leads with nothing set yet aren't sent by the backend;
// campaignLeadFor() fills them in as Unsent.
export type CampaignLead = {
  contactId: number;
  status: CampaignLeadStatus;
  // "" until one is picked.
  sdStatus: SdStatus | "";
  sentChannels: OutreachChannel[];
  addedAt: string;
};

export function campaignLeadFor(leads: Map<number, CampaignLead>, contactId: number): CampaignLead {
  return leads.get(contactId) ?? { contactId, status: "unsent", sdStatus: "", sentChannels: [], addedAt: "" };
}

export type Campaign = {
  id: number;
  name: string;
  description: string;
  leadCount: number;
  sentLeadCount: number;
  // Distinct contacts reached (delivered, not bounced).
  sentCount: number;
  // Contacts whose latest attempt failed or bounced.
  failedCount: number;
  bouncedCount: number;
  sendCount: number;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// Where one contact stands in a campaign. Contacts it hasn't emailed have
// no entry.
export type CampaignContactStatus = {
  contactId: number;
  status: RecipientStatus;
  sentAt: string | null;
  error: string;
  templateName: string;
  attempts: number;
};

export type CampaignDetail = {
  campaign: Campaign;
  // By lead id; only leads with something set in this campaign.
  leads: Map<number, CampaignLead>;
  statuses: Map<number, CampaignContactStatus>;
  // Newest first.
  sends: EmailSend[];
};

type CampaignItemResponse = {
  campaign_id: number;
  name: string;
  description: string | null;
  lead_count: number;
  sent_lead_count: number;
  sent_count: number;
  failed_count: number;
  bounced_count: number;
  send_count: number;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignLeadResponse = {
  contact_id: number;
  status: CampaignLeadStatus;
  sd_status: SdStatus | null;
  sent_channels: OutreachChannel[];
  added_at: string;
};

type CampaignDetailResponse = {
  campaign: CampaignItemResponse;
  leads: CampaignLeadResponse[];
  contacts: {
    contact_id: number;
    status: RecipientStatus;
    sent_at: string | null;
    error: string | null;
    template_name: string | null;
    attempts: number;
  }[];
  sends: SendItemResponse[];
};

function toCampaign(item: CampaignItemResponse): Campaign {
  return {
    id: item.campaign_id,
    name: item.name,
    description: item.description ?? "",
    leadCount: item.lead_count,
    sentLeadCount: item.sent_lead_count,
    sentCount: item.sent_count,
    failedCount: item.failed_count,
    bouncedCount: item.bounced_count,
    sendCount: item.send_count,
    lastSentAt: item.last_sent_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function toCampaignLead(item: CampaignLeadResponse): CampaignLead {
  return {
    contactId: item.contact_id,
    status: item.status,
    sdStatus: item.sd_status ?? "",
    sentChannels: item.sent_channels,
    addedAt: item.added_at,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") {
    return body.detail.charAt(0).toUpperCase() + body.detail.slice(1);
  }
  return fallback;
}

async function postJson(path: string, body: unknown, fallback: string): Promise<Response> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, fallback));
  }
  return response;
}

// Newest first.
export async function fetchCampaigns(): Promise<Campaign[]> {
  const response = await apiFetch("/admin/campaign/get_campaigns");
  if (!response.ok) {
    throw new Error("Failed to load the campaigns.");
  }
  const items: CampaignItemResponse[] = await response.json();
  return items.map(toCampaign);
}

export async function fetchCampaign(id: number): Promise<CampaignDetail> {
  const response = await apiFetch(`/admin/campaign/get_campaign?campaign_id=${id}`);
  if (!response.ok) {
    throw new Error(response.status === 404 ? "This campaign doesn't exist any more." : "Failed to load the campaign.");
  }
  const body: CampaignDetailResponse = await response.json();
  return {
    campaign: toCampaign(body.campaign),
    leads: new Map(body.leads.map((item) => [item.contact_id, toCampaignLead(item)])),
    statuses: new Map(
      body.contacts.map((entry) => [
        entry.contact_id,
        {
          contactId: entry.contact_id,
          status: entry.status,
          sentAt: entry.sent_at,
          error: entry.error ?? "",
          templateName: entry.template_name ?? "",
          attempts: entry.attempts,
        },
      ]),
    ),
    sends: body.sends.map(toSend),
  };
}

export async function addCampaign(fields: { name: string; description: string }): Promise<Campaign> {
  const response = await postJson("/admin/campaign/add_campaign", fields, "Couldn't save the campaign. Please try again.");
  const body: { campaign: CampaignItemResponse } = await response.json();
  return toCampaign(body.campaign);
}

// "" clears the description.
export async function updateCampaign(id: number, fields: { name: string; description: string }): Promise<Campaign> {
  const response = await postJson(
    "/admin/campaign/update_campaign",
    { campaign_id: id, ...fields },
    "Couldn't save the campaign. Please try again.",
  );
  const body: { campaign: CampaignItemResponse } = await response.json();
  return toCampaign(body.campaign);
}

export async function deleteCampaign(id: number): Promise<void> {
  await postJson(
    "/admin/campaign/update_campaign",
    { campaign_id: id, delete: true },
    "Couldn't delete the campaign. Please try again.",
  );
}

// One of a lead's campaign columns. "" clears the SD status. Returns the
// lead as saved (a Sent status change can flip its Status) and whether the
// lead is now Warm.
export async function updateCampaignLead(
  campaignId: number,
  contactId: number,
  fields: { status?: CampaignLeadStatus; sdStatus?: SdStatus | ""; sentChannels?: OutreachChannel[] },
): Promise<{ lead: CampaignLead; warm: boolean }> {
  const response = await postJson(
    "/admin/campaign/update_lead",
    {
      campaign_id: campaignId,
      contact_id: contactId,
      status: fields.status,
      sd_status: fields.sdStatus,
      sent_channels: fields.sentChannels,
    },
    "Couldn't save the change. Please try again.",
  );
  const body: { lead: CampaignLeadResponse; warm: boolean } = await response.json();
  return { lead: toCampaignLead(body.lead), warm: body.warm };
}
