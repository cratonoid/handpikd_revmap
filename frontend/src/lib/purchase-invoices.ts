// ---------------------------------------------------------------------------
// Purchase invoice data for the /admin/invoices Purchase Invoices tab
// ---------------------------------------------------------------------------
// Mirrors lib/invoices.ts. Fetches from GET /admin/get_purchase_invoice_details
// (backend/app/api/routes/purchase_invoices.py), which only ever returns
// active (non-deleted) purchase invoices. A purchase invoice is always
// raised against an existing PurchaseOrders record — vendor and totals are
// snapshotted from it at create time, same borrowing convention as sales
// invoices riding on a sales order. poId/vendorId are immutable once raised;
// a vendor PDF can optionally be attached (and later replaced) independently
// of that via attachPurchaseInvoicePdf.
//
// There is deliberately no create function here: a purchase invoice is
// raised automatically as part of creating its purchase order (see
// createPurchaseOrder's flow in components/admin/purchase-order-form-modal.tsx
// and services/purchase_invoices.py on the backend), so the Purchase
// Invoices tab lists, edits and voids them but never adds one.
//
// Nor is there a branded PDF to download. A purchase invoice records what a
// VENDOR billed us, so their own document is the authoritative one and the
// only one served — downloadUploadedPurchaseInvoicePdf is the whole of it.
// Sales invoices still render (lib/invoices.ts); those are documents we
// genuinely issue.
import { apiFetch } from "@/lib/api";

export type PurchaseInvoice = {
  id: number;
  purchaseInvoiceNo: number;
  purchaseInvoiceNoDisplay: string;
  date: string;
  vendorId: number;
  poId: number;
  // The vendor's own invoice number, present only for orders created by
  // uploading their invoice PDF.
  vendorInvoiceNo: string | null;
  hasUploadedPdf: boolean;
  totalAmountBeforeTax: number;
  totalTaxAmount: number;
  totalAmountAfterTax: number;
  isDeleted: boolean;
};

// Shape returned by the backend's PurchaseInvoiceDetailItem schema.
type PurchaseInvoiceDetailItem = {
  id: number;
  purchase_invoice_no: number;
  purchase_invoice_no_display: string;
  date: string;
  vendor_id: number;
  po_id: number;
  vendor_invoice_no: string | null;
  has_uploaded_pdf: boolean;
  total_amount_before_tax: number;
  total_tax_amount: number;
  total_amount_after_tax: number;
  is_deleted: boolean;
};

function toPurchaseInvoice(item: PurchaseInvoiceDetailItem): PurchaseInvoice {
  return {
    id: item.id,
    purchaseInvoiceNo: item.purchase_invoice_no,
    purchaseInvoiceNoDisplay: item.purchase_invoice_no_display,
    date: item.date,
    vendorId: item.vendor_id,
    poId: item.po_id,
    vendorInvoiceNo: item.vendor_invoice_no,
    hasUploadedPdf: item.has_uploaded_pdf,
    totalAmountBeforeTax: item.total_amount_before_tax,
    totalTaxAmount: item.total_tax_amount,
    totalAmountAfterTax: item.total_amount_after_tax,
    isDeleted: item.is_deleted,
  };
}

export async function fetchPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const response = await apiFetch("/admin/get_purchase_invoice_details");
  if (!response.ok) {
    throw new Error("Failed to load purchase invoices");
  }

  const items: PurchaseInvoiceDetailItem[] = await response.json();
  return items.map(toPurchaseInvoice);
}

// Attaches a vendor PDF to a purchase invoice via POST
// /admin/attach_purchase_invoice_pdf, or replaces the one already attached —
// the backend hard-deletes the old file from disk once the new one is saved,
// so there's no history/versions kept.
export async function attachPurchaseInvoicePdf(purchaseInvoiceId: number, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("purchase_invoice_id", String(purchaseInvoiceId));
  formData.append("file", file);

  const response = await apiFetch("/admin/attach_purchase_invoice_pdf", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to attach PDF");
  }
}

export type UpdatePurchaseInvoicePayload = {
  id: number;
  date: string;
  isDeleted: boolean;
};

export async function updatePurchaseInvoice(payload: UpdatePurchaseInvoicePayload): Promise<Response> {
  return apiFetch("/admin/update_purchase_invoice_details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: payload.id,
      date: payload.date,
      is_deleted: payload.isDeleted,
    }),
  });
}

// The vendor's own PDF, and the only one there is. Named after our record
// rather than their file so a folder of downloads sorts the way the list
// does; it used to carry an "-original" suffix, back when there was a
// generated PDF for it to be distinguished from.
export async function downloadUploadedPurchaseInvoicePdf(
  purchaseInvoiceId: number,
  purchaseInvoiceNoDisplay: string,
): Promise<void> {
  const response = await apiFetch(
    `/admin/get_purchase_invoice_uploaded_pdf?purchase_invoice_id=${purchaseInvoiceId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to download PDF");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${purchaseInvoiceNoDisplay}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Bulk-downloads every attached vendor PDF dated within [startDate, endDate]
// (both "YYYY-MM-DD") as a single .zip — the purchase-side counterpart of
// downloadInvoicesZip in lib/invoices.ts, and the same blob-and-throwaway-link
// approach, since the endpoint needs the Authorization header too. Invoices
// with no PDF attached are skipped by the backend rather than erroring, so a
// range containing only those comes back as the 404 below.
export async function downloadPurchaseInvoicesZip(startDate: string, endDate: string): Promise<void> {
  const response = await apiFetch(
    `/admin/get_purchase_invoices_pdf_zip?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No purchase invoice PDFs found in that date range.");
    }
    throw new Error("Failed to generate purchase invoices zip");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `purchase-invoices-${startDate}-to-${endDate}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
