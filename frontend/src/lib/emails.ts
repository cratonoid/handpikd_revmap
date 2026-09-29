// ---------------------------------------------------------------------------
// Emails — templates, signature and sending through the company's Titan mailbox
// ---------------------------------------------------------------------------
// Backed by /admin/email/* (backend/app/api/routes/emails.py). Templates
// each belong to one audience — leads or clients — and the compose screen
// only offers the ones matching its recipients; the backend refuses a
// mismatch too. Sending runs in the background on the server: sendEmail()
// returns straight away with the send's id, and fetchSend() is polled for
// progress.
import { apiFetch } from "@/lib/api";

export type EmailAudience = "lead" | "client";

export const AUDIENCE_LABELS: Record<EmailAudience, { singular: string; plural: string }> = {
  lead: { singular: "Lead", plural: "Leads" },
  client: { singular: "Client", plural: "Clients" },
};

// Mirrors PLACEHOLDER_FIELDS in backend/app/services/email_render.py.
export const PLACEHOLDER_FIELDS: Record<EmailAudience, { key: string; label: string }[]> = {
  lead: [
    { key: "name", label: "Company name" },
    { key: "contact_person", label: "Contact person" },
  ],
  client: [{ key: "name", label: "Client name" }],
};

export type EmailStatus = {
  configured: boolean;
  fromAddress: string;
  fromName: string;
  bulkLimit: number;
};

export type TemplateAttachment = {
  id: number;
  filename: string;
  contentType: string;
  size: number;
};

export type EmailTemplate = {
  id: number;
  name: string;
  audience: EmailAudience;
  subject: string;
  bodyHtml: string;
  attachments: TemplateAttachment[];
  createdAt: string;
  updatedAt: string;
};

export type RecipientStatus = "pending" | "sent" | "failed";

export type EmailSendRecipient = {
  contactId: number;
  name: string;
  email: string;
  status: RecipientStatus;
  error: string;
  savedToSent: boolean;
  sentAt: string | null;
};

export type EmailSend = {
  id: number;
  audience: EmailAudience;
  templateName: string;
  subject: string;
  bodyHtml: string;
  attachmentNames: string[];
  done: boolean;
  interrupted: boolean;
  total: number;
  sentCount: number;
  failedCount: number;
  recipients: EmailSendRecipient[];
  createdAt: string;
};

export type SendEmailInput = {
  audience: EmailAudience;
  contactIds: number[];
  templateId: number | null;
  subject: string;
  bodyHtml: string;
  templateAttachmentIds: number[];
  includeSignature: boolean;
  files: File[];
};

type TemplateItemResponse = {
  template_id: number;
  name: string;
  audience: EmailAudience;
  subject: string;
  body_html: string;
  attachments: { attachment_id: number; filename: string; content_type: string; size: number }[];
  created_at: string;
  updated_at: string;
};

type SendItemResponse = {
  send_id: number;
  audience: EmailAudience;
  template_name: string | null;
  subject: string;
  body_html: string;
  attachment_names: string[];
  status: "sending" | "done";
  interrupted: boolean;
  total: number;
  sent_count: number;
  failed_count: number;
  recipients: {
    contact_id: number;
    name: string;
    email: string;
    status: RecipientStatus;
    error: string | null;
    saved_to_sent: boolean;
    sent_at: string | null;
  }[];
  created_at: string;
};

function toTemplate(item: TemplateItemResponse): EmailTemplate {
  return {
    id: item.template_id,
    name: item.name,
    audience: item.audience,
    subject: item.subject,
    bodyHtml: item.body_html,
    attachments: item.attachments.map((attachment) => ({
      id: attachment.attachment_id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      size: attachment.size,
    })),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function toSend(item: SendItemResponse): EmailSend {
  return {
    id: item.send_id,
    audience: item.audience,
    templateName: item.template_name ?? "",
    subject: item.subject,
    bodyHtml: item.body_html,
    attachmentNames: item.attachment_names,
    done: item.status === "done",
    interrupted: item.interrupted,
    total: item.total,
    sentCount: item.sent_count,
    failedCount: item.failed_count,
    recipients: item.recipients.map((recipient) => ({
      contactId: recipient.contact_id,
      name: recipient.name,
      email: recipient.email,
      status: recipient.status,
      error: recipient.error ?? "",
      savedToSent: recipient.saved_to_sent,
      sentAt: recipient.sent_at,
    })),
    createdAt: item.created_at,
  };
}

async function detailOr(response: Response, fallback: string): Promise<string> {
  if (response.status === 413) {
    return "Those attachments are too large to upload.";
  }
  const body: { detail?: unknown } = await response.json().catch(() => ({}));
  if (typeof body.detail === "string") {
    // Backend messages start lower-case to read well mid-sentence in logs.
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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Same substitution the backend does per recipient, for the compose
// screen's preview. Values are escaped in the body, exactly as they will
// be in the real email.
export function fillPlaceholders(text: string, values: Record<string, string>, escapeHtml: boolean): string {
  return text.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) return match;
    if (!escapeHtml) return value;
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  });
}

export function placeholderValues(name: string, contactPerson: string): Record<string, string> {
  // A lead with no contact person still gets greeted by company name —
  // same fallback as placeholder_values in services/email_render.py.
  return { name, contact_person: contactPerson || name };
}

// --- status ----------------------------------------------------------------

export async function fetchEmailStatus(): Promise<EmailStatus> {
  const response = await apiFetch("/admin/email/get_status");
  if (!response.ok) {
    throw new Error("Couldn't check the email settings.");
  }
  const body: { configured: boolean; from_address: string; from_name: string; bulk_limit: number } =
    await response.json();
  return {
    configured: body.configured,
    fromAddress: body.from_address,
    fromName: body.from_name,
    bulkLimit: body.bulk_limit,
  };
}

// Resolves with a confirmation message; throws with Titan's complaint.
export async function testEmailConnection(): Promise<string> {
  const response = await postJson("/admin/email/test_connection", {}, "Couldn't connect to the mail server.");
  const body: { message: string } = await response.json();
  return body.message;
}

// --- templates -------------------------------------------------------------

export async function fetchTemplates(): Promise<EmailTemplate[]> {
  const response = await apiFetch("/admin/email/get_templates");
  if (!response.ok) {
    throw new Error("Failed to load the email templates.");
  }
  const items: TemplateItemResponse[] = await response.json();
  return items.map(toTemplate);
}

export async function addTemplate(fields: {
  name: string;
  audience: EmailAudience;
  subject: string;
  bodyHtml: string;
}): Promise<EmailTemplate> {
  const response = await postJson(
    "/admin/email/add_template",
    { name: fields.name, audience: fields.audience, subject: fields.subject, body_html: fields.bodyHtml },
    "Couldn't save the template. Please try again.",
  );
  const body: { template: TemplateItemResponse } = await response.json();
  return toTemplate(body.template);
}

export async function updateTemplate(
  id: number,
  fields: { name: string; subject: string; bodyHtml: string },
): Promise<EmailTemplate> {
  const response = await postJson(
    "/admin/email/update_template",
    { template_id: id, name: fields.name, subject: fields.subject, body_html: fields.bodyHtml },
    "Couldn't save the template. Please try again.",
  );
  const body: { template: TemplateItemResponse } = await response.json();
  return toTemplate(body.template);
}

export async function deleteTemplate(id: number): Promise<void> {
  await postJson(
    "/admin/email/update_template",
    { template_id: id, delete: true },
    "Couldn't delete the template. Please try again.",
  );
}

export async function addTemplateAttachment(templateId: number, file: File): Promise<EmailTemplate> {
  const formData = new FormData();
  formData.append("template_id", String(templateId));
  formData.append("file", file);
  const response = await apiFetch("/admin/email/add_template_attachment", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await detailOr(response, `Couldn't attach ${file.name}.`));
  }
  const body: { template: TemplateItemResponse } = await response.json();
  return toTemplate(body.template);
}

export async function removeTemplateAttachment(templateId: number, attachmentId: number): Promise<EmailTemplate> {
  const response = await postJson(
    "/admin/email/remove_template_attachment",
    { template_id: templateId, attachment_id: attachmentId },
    "Couldn't remove the attachment.",
  );
  const body: { template: TemplateItemResponse } = await response.json();
  return toTemplate(body.template);
}

// --- signature -------------------------------------------------------------

export async function fetchSignature(): Promise<string> {
  const response = await apiFetch("/admin/email/get_signature");
  if (!response.ok) {
    throw new Error("Failed to load the email signature.");
  }
  const body: { signature_html: string } = await response.json();
  return body.signature_html;
}

export async function saveSignature(signatureHtml: string): Promise<string> {
  const response = await postJson(
    "/admin/email/update_signature",
    { signature_html: signatureHtml },
    "Couldn't save the signature. Please try again.",
  );
  const body: { signature_html: string } = await response.json();
  return body.signature_html;
}

// --- sending ---------------------------------------------------------------

export async function sendEmail(input: SendEmailInput): Promise<EmailSend> {
  const formData = new FormData();
  formData.append(
    "payload",
    JSON.stringify({
      audience: input.audience,
      contact_ids: input.contactIds,
      template_id: input.templateId,
      subject: input.subject,
      body_html: input.bodyHtml,
      template_attachment_ids: input.templateAttachmentIds,
      include_signature: input.includeSignature,
    }),
  );
  for (const file of input.files) {
    formData.append("files", file);
  }
  const response = await apiFetch("/admin/email/send", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await detailOr(response, "Couldn't send the email. Please try again."));
  }
  const body: { send: SendItemResponse } = await response.json();
  return toSend(body.send);
}

export async function fetchSend(id: number): Promise<EmailSend> {
  const response = await apiFetch(`/admin/email/get_send?send_id=${id}`);
  if (!response.ok) {
    throw new Error("Couldn't check on the send.");
  }
  return toSend(await response.json());
}

export async function fetchSends(): Promise<EmailSend[]> {
  const response = await apiFetch("/admin/email/get_sends");
  if (!response.ok) {
    throw new Error("Failed to load the sent emails.");
  }
  const items: SendItemResponse[] = await response.json();
  return items.map(toSend);
}
