// ---------------------------------------------------------------------------
// Letter data for the /admin/letters tab
// ---------------------------------------------------------------------------
// A letter is the simplest document here: an addressee, a subject and some
// prose, printed on the same letterhead as a quotation (backend/app/
// templates/letter.html). The addressee is free text stored on the letter —
// the form can prefill it from a client, but nothing links back to one.
//
// Like createQuotation, createLetter returns the new row's id/letterNo so
// the form's "Generate letter" button can chain straight into
// downloadLetterPdf without re-fetching the list.
import { apiFetch } from "@/lib/api";

export type Letter = {
  id: number;
  letterNo: number;
  date: string;
  recipientName: string;
  recipientAddress: string;
  subject: string;
  salutation: string;
  body: string;
  closing: string;
  signatoryName: string;
  signatoryDesignation: string;
  includeSignature: boolean;
  isDeleted: boolean;
};

// Shape returned by the backend's LetterDetailItem schema.
type LetterDetailItem = {
  id: number;
  letter_no: number;
  date: string;
  recipient_name: string;
  recipient_address: string;
  subject: string;
  salutation: string;
  body: string;
  closing: string;
  signatory_name: string;
  signatory_designation: string;
  include_signature: boolean;
  is_deleted: boolean;
};

function toLetter(item: LetterDetailItem): Letter {
  return {
    id: item.id,
    letterNo: item.letter_no,
    date: item.date,
    recipientName: item.recipient_name,
    recipientAddress: item.recipient_address,
    subject: item.subject,
    salutation: item.salutation,
    body: item.body,
    closing: item.closing,
    signatoryName: item.signatory_name,
    signatoryDesignation: item.signatory_designation,
    includeSignature: item.include_signature,
    isDeleted: item.is_deleted,
  };
}

export async function fetchLetters(): Promise<Letter[]> {
  const response = await apiFetch("/admin/get_letter_details");
  if (!response.ok) {
    throw new Error("Failed to load letters");
  }

  const items: LetterDetailItem[] = await response.json();
  return items.map(toLetter);
}

export type CreateLetterPayload = Omit<Letter, "id" | "letterNo" | "isDeleted">;

export type UpdateLetterPayload = CreateLetterPayload & {
  id: number;
  isDeleted?: boolean;
};

function toRequestBody(payload: CreateLetterPayload) {
  return {
    date: payload.date,
    recipient_name: payload.recipientName,
    recipient_address: payload.recipientAddress,
    subject: payload.subject,
    salutation: payload.salutation,
    body: payload.body,
    closing: payload.closing,
    signatory_name: payload.signatoryName,
    signatory_designation: payload.signatoryDesignation,
    include_signature: payload.includeSignature,
  };
}

export async function createLetter(payload: CreateLetterPayload): Promise<{ id: number; letterNo: number }> {
  const response = await apiFetch("/admin/create_new_letter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toRequestBody(payload)),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : "Failed to create letter");
  }

  const body: { id: number; letter_no: number } = await response.json();
  return { id: body.id, letterNo: body.letter_no };
}

export async function updateLetter(payload: UpdateLetterPayload): Promise<Response> {
  return apiFetch("/admin/update_letter_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      is_deleted: payload.isDeleted ?? false,
      ...toRequestBody(payload),
    }),
  });
}

// Same blob + object-URL download as downloadQuotationPdf — the endpoint
// needs the bearer header a plain <a href> can't send.
export async function downloadLetterPdf(letterId: number, letterNo: number): Promise<void> {
  const response = await apiFetch(`/admin/get_letter_pdf?letter_id=${letterId}`);
  if (!response.ok) {
    throw new Error("Failed to generate letter PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `letter-${letterNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
