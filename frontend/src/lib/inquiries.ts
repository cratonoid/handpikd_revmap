// The Inquiries module (backend/app/api/routes/inquiries.py): what a
// Database lead is asking for, who on the team owns it, and a timeline of
// statuses added one after another. The latest step is the current status.
import { apiFetch } from "@/lib/api";

export type InquiryStatus =
  | "requirements_received"
  | "options_shared"
  | "samples_delivered"
  | "advance_paid"
  | "custom";

export const INQUIRY_STATUS_OPTIONS: { value: InquiryStatus; label: string }[] = [
  { value: "requirements_received", label: "Requirements received" },
  { value: "options_shared", label: "Options shared" },
  { value: "samples_delivered", label: "Samples delivered" },
  { value: "advance_paid", label: "Advance paid" },
  { value: "custom", label: "Custom…" },
];

export type InquiryStep = {
  status: InquiryStatus;
  label: string;
  note: string;
  createdAt: string;
  createdByName: string;
};

export type Inquiry = {
  id: number;
  contactId: number;
  leadName: string;
  details: string;
  assignedUserId: number | null;
  assignedUserName: string;
  currentStatus: InquiryStatus | null;
  currentStatusLabel: string;
  // Oldest first.
  steps: InquiryStep[];
  createdAt: string;
  updatedAt: string;
};

export type InquiryOption = { id: number; name: string };

export type StepFields = { status: InquiryStatus; customLabel: string; note: string };

type InquiryItemResponse = {
  inquiry_id: number;
  contact_id: number;
  lead_name: string;
  details: string;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  current_status: InquiryStatus | null;
  current_status_label: string | null;
  steps: {
    status: InquiryStatus;
    label: string;
    note: string | null;
    created_at: string;
    created_by_name: string | null;
  }[];
  created_at: string;
  updated_at: string;
};

function toInquiry(item: InquiryItemResponse): Inquiry {
  return {
    id: item.inquiry_id,
    contactId: item.contact_id,
    leadName: item.lead_name,
    details: item.details,
    assignedUserId: item.assigned_user_id,
    assignedUserName: item.assigned_user_name ?? "",
    currentStatus: item.current_status,
    currentStatusLabel: item.current_status_label ?? "",
    steps: item.steps.map((step) => ({
      status: step.status,
      label: step.label,
      note: step.note ?? "",
      createdAt: step.created_at,
      createdByName: step.created_by_name ?? "",
    })),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function toStepRequest(fields: StepFields) {
  return {
    status: fields.status,
    custom_label: fields.status === "custom" ? fields.customLabel : null,
    note: fields.note || null,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") {
    return body.detail.charAt(0).toUpperCase() + body.detail.slice(1);
  }
  return fallback;
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(fallback);
  return response.json();
}

async function postInquiry(path: string, body: unknown): Promise<Inquiry> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't save the inquiry. Please try again."));
  }
  const data: { inquiry: InquiryItemResponse } = await response.json();
  return toInquiry(data.inquiry);
}

// Most recently updated first.
export async function fetchInquiries(): Promise<Inquiry[]> {
  const items = await getJson<InquiryItemResponse[]>("/admin/inquiries/get_inquiries", "Failed to load inquiries.");
  return items.map(toInquiry);
}

export async function fetchAssignableUsers(): Promise<InquiryOption[]> {
  const items = await getJson<{ user_id: number; name: string }[]>(
    "/admin/inquiries/get_assignable_users",
    "Failed to load team members.",
  );
  return items.map((item) => ({ id: item.user_id, name: item.name }));
}

export async function fetchInquiryLeads(): Promise<InquiryOption[]> {
  const items = await getJson<{ contact_id: number; name: string }[]>(
    "/admin/inquiries/get_leads",
    "Failed to load leads.",
  );
  return items.map((item) => ({ id: item.contact_id, name: item.name }));
}

export function createInquiry(fields: {
  contactId: number;
  details: string;
  assignedUserId: number | null;
  firstStep: StepFields | null;
}): Promise<Inquiry> {
  return postInquiry("/admin/inquiries/create_inquiry", {
    contact_id: fields.contactId,
    details: fields.details,
    assigned_user_id: fields.assignedUserId,
    first_step: fields.firstStep ? toStepRequest(fields.firstStep) : null,
  });
}

// assignedUserId is always sent, so null unassigns.
export function updateInquiry(
  id: number,
  fields: { contactId: number; details: string; assignedUserId: number | null },
): Promise<Inquiry> {
  return postInquiry("/admin/inquiries/update_inquiry", {
    inquiry_id: id,
    contact_id: fields.contactId,
    details: fields.details,
    assigned_user_id: fields.assignedUserId,
  });
}

export function addInquiryStep(id: number, fields: StepFields): Promise<Inquiry> {
  return postInquiry("/admin/inquiries/add_step", { inquiry_id: id, ...toStepRequest(fields) });
}
