// ---------------------------------------------------------------------------
// Campaigns — named mail-outs over the whole Database address book
// ---------------------------------------------------------------------------
// Backed by /admin/campaign/* (backend/app/api/routes/campaigns.py). A
// campaign holds only a name and a note: its contacts are the live rows of
// /admin/database (lib/database-contacts.ts), and its mail goes out through
// the Emails module's sendEmail() with the campaign's id attached. Who has
// been sent what comes back from fetchCampaign(), worked out on the server
// from those sends.
import { apiFetch } from "@/lib/api";
import { toSend, type EmailSend, type RecipientStatus, type SendItemResponse } from "@/lib/emails";

export type Campaign = {
  id: number;
  name: string;
  description: string;
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
  statuses: Map<number, CampaignContactStatus>;
  // Newest first.
  sends: EmailSend[];
};

type CampaignItemResponse = {
  campaign_id: number;
  name: string;
  description: string | null;
  sent_count: number;
  failed_count: number;
  bounced_count: number;
  send_count: number;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignDetailResponse = {
  campaign: CampaignItemResponse;
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
    sentCount: item.sent_count,
    failedCount: item.failed_count,
    bouncedCount: item.bounced_count,
    sendCount: item.send_count,
    lastSentAt: item.last_sent_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
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
